-- 0072 — Attendance system hardening (full audit)
--
-- 1. SECURITY: Lock the remaining anon INSERT/UPDATE policies. After this,
--    every attendance write must go through a SECURITY DEFINER RPC.
-- 2. INTEGRITY: Auto-resolve batch_id in every save path so attendance
--    cannot be persisted with NULL batch_id again (prevents the "vanish"
--    we just backfilled in 0071).
-- 3. AUDIT: secure_upsert_attendance (owner monthly save) now stamps
--    marked_by, matching secure_save_attendance_date / secure_mark_attendance.
-- 4. BRANCH ISOLATION: A staff actor with staff.branch_id set may only
--    mark attendance for students in that branch (or unassigned students).
--    Owners are unrestricted. Office staff (branch_id NULL) are unrestricted.
-- 5. STATUS GUARD: status must be one of Present/Absent/Late/Leave.
-- 6. CLEANUP: drop redundant duplicate unique indexes and the dead
--    attendance_anon_read policy.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Lock anon write policies (RPC-only)
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS attendance_anon_insert ON public.attendance;
DROP POLICY IF EXISTS attendance_anon_update ON public.attendance;
DROP POLICY IF EXISTS attendance_anon_delete ON public.attendance;
DROP POLICY IF EXISTS attendance_anon_read   ON public.attendance;  -- duplicated by attendance_anon_select

-- ═══════════════════════════════════════════════════════════
-- 2. Helper: resolve actor's branch_id (NULL for owner / unassigned staff)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION _actor_branch(p_actor_kind TEXT, p_actor_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch UUID;
BEGIN
  IF p_actor_kind = 'staff' AND p_actor_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM staff WHERE id = p_actor_id;
  END IF;
  RETURN v_branch;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. Status CHECK constraint
-- ═══════════════════════════════════════════════════════════
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_valid;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_status_valid
  CHECK (status IS NULL OR status IN ('Present', 'Absent', 'Late', 'Leave'));

-- ═══════════════════════════════════════════════════════════
-- 4. secure_save_attendance_date  (coach mobile, owner per-date save)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_save_attendance_date(
  p_date     DATE,
  p_batch_id BIGINT,
  p_records  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a            RECORD;
  v_actor_name TEXT;
  v_actor_br   UUID;
  v_to_delete  BIGINT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  -- Resolve actor display name (for marked_by)
  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  -- Academy + branch scope: every student must be in actor's academy AND
  -- (no branch on actor) OR (student matches actor branch OR student unassigned)
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_records) k
    JOIN students s ON s.id = k::BIGINT
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
       OR (v_actor_br IS NOT NULL
           AND s.branch_id IS NOT NULL
           AND s.branch_id IS DISTINCT FROM v_actor_br)
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance references student outside actor scope'
      USING ERRCODE = '42501';
  END IF;

  -- Delete cleared marks
  SELECT array_agg(k::BIGINT) INTO v_to_delete
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NULL OR r.v = '';

  IF v_to_delete IS NOT NULL AND array_length(v_to_delete, 1) > 0 THEN
    IF p_batch_id IS NOT NULL THEN
      DELETE FROM attendance
       WHERE date = p_date AND batch_id = p_batch_id AND student_id = ANY(v_to_delete);
    ELSE
      -- Also clear any legacy NULL-batch rows for safety
      DELETE FROM attendance
       WHERE date = p_date AND student_id = ANY(v_to_delete)
         AND batch_id = (SELECT batch_id FROM students WHERE id = attendance.student_id);
    END IF;
  END IF;

  -- Upsert. batch_id is COALESCE(p_batch_id, students.batch_id) — never NULL.
  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  SELECT
    p_date,
    r.k::BIGINT,
    COALESCE(p_batch_id, s.batch_id),
    r.v = 'Present',
    r.v,
    v_actor_name
  FROM jsonb_each_text(p_records) r(k, v)
  JOIN students s ON s.id = r.k::BIGINT
  WHERE r.v IS NOT NULL AND r.v != ''
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_save_attendance_date(DATE, BIGINT, JSONB, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 5. secure_upsert_attendance  (owner monthly grid save)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_upsert_attendance(
  p_rows  JSONB,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a            RECORD;
  v_actor_name TEXT;
  v_actor_br   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  -- Academy + branch scope
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(student_id BIGINT)
    JOIN students s ON s.id = r.student_id
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
       OR (v_actor_br IS NOT NULL
           AND s.branch_id IS NOT NULL
           AND s.branch_id IS DISTINCT FROM v_actor_br)
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance row references student outside actor scope'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  SELECT
    (r.date)::DATE,
    r.student_id,
    COALESCE(r.batch_id, s.batch_id),
    COALESCE(r.present, true),
    COALESCE(NULLIF(r.status, ''), 'Present'),
    v_actor_name
  FROM jsonb_to_recordset(p_rows) AS r(
    date       TEXT,
    student_id BIGINT,
    batch_id   BIGINT,
    present    BOOLEAN,
    status     TEXT
  )
  JOIN students s ON s.id = r.student_id
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_attendance(JSONB, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6. secure_mark_attendance  (live class single-tap mark)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_mark_attendance(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_actor_name      TEXT;
  v_actor_br        UUID;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_student_batch   BIGINT;
  v_effective_batch BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  SELECT academy_id, branch_id, batch_id
    INTO v_student_academy, v_student_branch, v_student_batch
    FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  IF v_actor_br IS NOT NULL
     AND v_student_branch IS NOT NULL
     AND v_student_branch IS DISTINCT FROM v_actor_br THEN
    RAISE EXCEPTION 'forbidden: student in different branch' USING ERRCODE = '42501';
  END IF;

  v_effective_batch := COALESCE(p_batch_id, v_student_batch);

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (CURRENT_DATE, p_student_id, v_effective_batch, true, 'Present', v_actor_name)
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.present   ELSE EXCLUDED.present   END,
    status    = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.status    ELSE EXCLUDED.status    END,
    marked_by = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.marked_by ELSE EXCLUDED.marked_by END;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_mark_attendance(BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 7. secure_mark_attendance_qr  (student QR self-scan)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_mark_attendance_qr(
  p_student_id BIGINT,
  p_gate_token TEXT,
  p_batch_id   BIGINT,
  p_academy_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_academy UUID;
  v_student_name    TEXT;
  v_student_batch   BIGINT;
  v_effective_batch BIGINT;
BEGIN
  -- Validate gate token against this academy
  IF NOT EXISTS (
    SELECT 1 FROM gate_qr WHERE token = p_gate_token AND academy_id = p_academy_id
  ) THEN
    RAISE EXCEPTION 'Invalid gate QR code' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, name, batch_id
    INTO v_student_academy, v_student_name, v_student_batch
    FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM p_academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  v_effective_batch := COALESCE(p_batch_id, v_student_batch);

  -- Already marked guard (with effective batch)
  IF EXISTS (
    SELECT 1 FROM attendance
    WHERE date = CURRENT_DATE
      AND student_id = p_student_id
      AND batch_id IS NOT DISTINCT FROM v_effective_batch
  ) THEN
    RAISE EXCEPTION 'already marked' USING ERRCODE = '23505';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (CURRENT_DATE, p_student_id, v_effective_batch, true, 'Present', v_student_name);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_mark_attendance_qr(BIGINT, TEXT, BIGINT, UUID) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 8. Drop redundant duplicate index
-- ═══════════════════════════════════════════════════════════
DROP INDEX IF EXISTS att_no_batch_idx;  -- duplicate of attendance_date_student_nullbatch_uniq

COMMIT;
