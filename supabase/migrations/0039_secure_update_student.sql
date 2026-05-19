-- ============================================================
-- 0039 — Phase 2 Stage 6a: secure student UPDATE RPCs
-- ============================================================
-- WHY
--   Payments are now fully locked (Stages 1-5). Students still have a
--   wide-open anon UPDATE policy (students_anon_update from migration
--   0031). A coach with the anon key can:
--     supabase.from('students').update({ status: 'Active' }).eq('id', X)
--     supabase.from('students').update({ paid_till: '2030-01-01' }).eq('id', X)
--   — unsuspending students without payment, or extending paid_till
--     to bypass the subscription enforcement entirely.
--
-- WHAT THIS DOES
--   Adds 4 SECURITY DEFINER RPCs covering all the write paths on the
--   students table that the app makes via the anon key:
--     1. secure_update_student       — profile + status + financial fields
--     2. secure_activate_student_account — student self-service activation
--     3. secure_reset_student_password   — owner/staff password reset
--     4. secure_update_student_photo     — student/staff photo update
--
--   anon UPDATE policy stays alive until migration 0040 to allow
--   safe zero-downtime deploy: update JS, apply 0039, verify, then 0040.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_update_student ──────────────────────────────
-- Handles all owner/staff writes: status changes, profile edits,
-- financial fields (paid_till, fees), batch assignment.
-- Returns the updated student row as JSON so callers that need
-- the updated record (updateStudent in db.js) can use it directly.
-- Only fields present in p_payload are touched — absent fields
-- retain their current DB value.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_student(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    name          = CASE WHEN p_payload ? 'name'
                      THEN COALESCE(NULLIF(p_payload->>'name',''), name)
                      ELSE name          END,
    parent        = CASE WHEN p_payload ? 'parent'
                      THEN COALESCE(p_payload->>'parent', '')
                      ELSE parent        END,
    phone         = CASE WHEN p_payload ? 'phone'
                      THEN COALESCE(p_payload->>'phone', '')
                      ELSE phone         END,
    parent_phone  = CASE WHEN p_payload ? 'parentPhone'
                      THEN COALESCE(p_payload->>'parentPhone', '')
                      ELSE parent_phone  END,
    age           = CASE WHEN p_payload ? 'age'
                      THEN NULLIF(p_payload->>'age','')::INT
                      ELSE age           END,
    dob           = CASE WHEN p_payload ? 'dob'
                      THEN NULLIF(p_payload->>'dob','')::DATE
                      ELSE dob           END,
    sport         = CASE WHEN p_payload ? 'sport'
                      THEN COALESCE(p_payload->>'sport', '')
                      ELSE sport         END,
    batch         = CASE WHEN p_payload ? 'batchName'
                      THEN COALESCE(p_payload->>'batchName', '')
                      ELSE batch         END,
    batch_id      = CASE WHEN p_payload ? 'batchId'
                      THEN NULLIF(p_payload->>'batchId','')::BIGINT
                      ELSE batch_id      END,
    fees          = CASE WHEN p_payload ? 'fees'
                      THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, 0)
                      ELSE fees          END,
    fee_amount    = CASE WHEN p_payload ? 'fees'
                      THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, 0)
                      ELSE fee_amount    END,
    paid_till     = CASE WHEN p_payload ? 'paidTill'
                      THEN NULLIF(p_payload->>'paidTill','')::DATE
                      ELSE paid_till     END,
    join_date     = CASE WHEN p_payload ? 'joinDate'
                      THEN NULLIF(p_payload->>'joinDate','')::DATE
                      ELSE join_date     END,
    training_type = CASE WHEN p_payload ? 'trainingType'
                      THEN COALESCE(NULLIF(p_payload->>'trainingType',''), 'Daily')
                      ELSE training_type END,
    fee_plan      = CASE WHEN p_payload ? 'feePlan'
                      THEN COALESCE(NULLIF(p_payload->>'feePlan',''), 'monthly')
                      ELSE fee_plan      END,
    position      = CASE WHEN p_payload ? 'position'
                      THEN NULLIF(p_payload->>'position','')
                      ELSE position      END,
    status        = CASE WHEN p_payload ? 'status'
                      THEN COALESCE(NULLIF(p_payload->>'status',''), status)
                      ELSE status        END,
    suspended_since = CASE WHEN p_payload ? 'suspendedSince'
                      THEN NULLIF(p_payload->>'suspendedSince','')::DATE
                      ELSE suspended_since END,
    branch_id     = CASE WHEN p_payload ? 'branchId'
                      THEN NULLIF(p_payload->>'branchId','')::UUID
                      ELSE branch_id     END
  WHERE id = p_student_id;

  RETURN (SELECT row_to_json(s) FROM students s WHERE s.id = p_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_student(BIGINT, JSONB, TEXT) TO anon, authenticated;


-- ── 2. secure_activate_student_account ───────────────────
-- Student self-service activation: validates student_code + join_code,
-- sets password_hash and marks account active.
-- No actor token required — the join_code itself is the credential.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_activate_student_account(
  p_student_code  TEXT,
  p_join_code     TEXT,
  p_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id BIGINT;
BEGIN
  SELECT id INTO v_student_id
  FROM students
  WHERE student_code  = upper(p_student_code)
    AND join_code     = upper(p_join_code)
    AND account_status = 'pending'
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Student ID or Join Code' USING ERRCODE = 'P0002';
  END IF;

  UPDATE students
  SET password_hash  = p_password_hash,
      account_status = 'active',
      join_code      = NULL
  WHERE id = v_student_id;

  RETURN (SELECT row_to_json(s) FROM students s WHERE s.id = v_student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_activate_student_account(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ── 3. secure_reset_student_password ─────────────────────
-- Owner/staff-initiated reset: clears password_hash, assigns a new
-- join_code, and returns the account to 'pending' state.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_reset_student_password(
  p_student_id BIGINT,
  p_join_code  TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  UPDATE students
  SET password_hash  = NULL,
      join_code      = p_join_code,
      account_status = 'pending'
  WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_reset_student_password(BIGINT, TEXT, TEXT) TO anon, authenticated;


-- ── 4. secure_update_student_photo ───────────────────────
-- Students may update their own photo; owners/staff may update
-- any student's photo in their academy.
-- _require_perm rejects students for destructive ops so we handle
-- the student-self path with a manual actor_kind check here.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_student_photo(
  p_student_id BIGINT,
  p_photo_url  TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'student' THEN
    -- Students may only update their own photo
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: students can only update their own photo' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Owners and staff must be in the same academy
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.view');
  END IF;

  UPDATE students SET photo_url = p_photo_url WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_student_photo(BIGINT, TEXT, TEXT) TO anon, authenticated;
