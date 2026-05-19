-- ============================================================
-- 0033 — Phase 2 Stage 1: secure delete RPCs
-- ============================================================
-- WHY
--   Migration 0032 left every table fully open to anon
--   (FOR ALL TO anon USING (true) WITH CHECK (true)) so the app keeps
--   working. The downside: a malicious user with the anon key (shipped
--   in the bundle) can call .from('students').delete() from DevTools
--   and wipe a tenant's data, since RLS is not enforcing anything.
--
-- WHAT THIS DOES
--   Adds SECURITY DEFINER RPCs that gate destructive deletes behind
--   token validation. The functions:
--     1. Resolve the calling actor via auth.uid() (owner JWT) OR a
--        passed-in token (staff/student localStorage session)
--     2. Check the actor has permission to delete on the target table
--     3. Verify the row belongs to the actor's academy
--     4. Perform the delete + cascades atomically
--
-- WHAT THIS DOES NOT DO YET
--   It does NOT remove the anon DELETE permission from the underlying
--   tables. So today, DevTools-bypass deletes still work. The next
--   migration (0034 in Stage 2) closes that hole by dropping the anon
--   DELETE on these 4 tables and forcing all callers through the RPC.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- current_actor — resolves the calling user's identity
--   Returns one row with: actor_kind, actor_id, academy_id, perms
--   actor_kind is NULL if no valid auth was found.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_actor(p_token TEXT DEFAULT NULL)
RETURNS TABLE (
  actor_kind  TEXT,
  actor_id    BIGINT,
  academy_id  UUID,
  perms       JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  -- 1. Try owner JWT (Supabase Auth path)
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    RETURN QUERY
      SELECT 'owner'::TEXT, NULL::BIGINT, p.academy_id, NULL::JSONB
      FROM profiles p
      WHERE p.id = v_uid
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Try staff session token
  IF p_token IS NOT NULL AND length(p_token) > 0 THEN
    RETURN QUERY
      SELECT 'staff'::TEXT, ss.staff_id, st.academy_id, COALESCE(sa.permissions::JSONB, '[]'::JSONB)
      FROM staff_sessions ss
      JOIN staff st       ON st.id  = ss.staff_id
      LEFT JOIN staff_auth sa ON sa.staff_id = st.id
      WHERE ss.token = p_token
        AND (ss.expires_at IS NULL OR ss.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;

  -- 3. Try student session token
    RETURN QUERY
      SELECT 'student'::TEXT, sst.student_id, s.academy_id, NULL::JSONB
      FROM student_sessions sst
      JOIN students s ON s.id = sst.student_id
      WHERE sst.token = p_token
        AND (sst.expires_at IS NULL OR sst.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- No valid auth → return nothing
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION current_actor(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- _require_perm — helper raises if actor cannot perform op
--   Owners are unrestricted within their own academy.
--   Staff are restricted by the perm string (e.g. 'students.manage').
--   Students are always rejected for destructive ops.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _require_perm(
  p_actor_kind TEXT,
  p_perms      JSONB,
  p_required   TEXT
) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden: students cannot perform this action' USING ERRCODE = '42501';
  END IF;
  IF p_actor_kind = 'owner' THEN
    RETURN; -- owners have full access within their academy
  END IF;
  -- staff: permissions is a JSON array of strings
  IF NOT (p_perms ? p_required) THEN
    RAISE EXCEPTION 'forbidden: missing permission %', p_required USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- secure_delete_student
--   Replaces the JS sequence: delete payments + sessions + student row.
--   Verifies the student belongs to the actor's academy.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_student(
  p_student_id BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  DELETE FROM payments         WHERE student_id = p_student_id;
  DELETE FROM student_sessions WHERE student_id = p_student_id;
  DELETE FROM students         WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_student(BIGINT, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- secure_delete_payment
--   Looks up the payment's academy via its student, verifies match.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_payment(
  p_payment_id TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_pay_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  -- payments.academy_id is denormalized; fall back to student lookup if null
  SELECT COALESCE(p.academy_id, s.academy_id)
    INTO v_pay_academy
    FROM payments p
    LEFT JOIN students s ON s.id = p.student_id
   WHERE p.id = p_payment_id;
  IF v_pay_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  DELETE FROM payments WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_payment(TEXT, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- secure_delete_batch
--   Verifies batch belongs to actor's academy.
--   Existing JS does the cascade check (count enrolments) in app code;
--   we leave that to the caller — this just gates the delete.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_batch(
  p_batch_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_batch_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id INTO v_batch_academy FROM batches WHERE id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  DELETE FROM batches WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_batch(BIGINT, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- secure_delete_staff
--   Owner-only. Staff cannot delete other staff regardless of perms.
--   Replaces the JS sequence: delete leave_requests + staff_attendance + staff row.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_staff(
  p_staff_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  v_target_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind <> 'owner' THEN
    RAISE EXCEPTION 'forbidden: only owners can delete staff' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_target_academy FROM staff WHERE id = p_staff_id;
  IF v_target_academy IS NULL THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  DELETE FROM leave_requests   WHERE staff_id   = p_staff_id;
  DELETE FROM staff_attendance WHERE profile_id = p_staff_id;
  DELETE FROM staff            WHERE id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_staff(BIGINT, TEXT) TO anon, authenticated;
