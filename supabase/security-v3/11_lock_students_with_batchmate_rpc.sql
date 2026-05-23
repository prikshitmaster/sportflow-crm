-- security-v3 / 11 — Phase 3.4a: lock students table
--
-- Last open SELECT shadow on a high-PII table. The existing
-- students_anon_read policy is:
--   USING (academy_id = current_staff_academy() OR id = current_student_id())
-- This is correct for staff (see all academy students) and for students
-- querying their own row — but a student can't see batchmates by
-- batch_id with this policy.
--
-- The StudentStats / pitch-view page needs batchmate data (id, name,
-- position, photo_url, status only — no phone/dob/fees). Add an RPC
-- that returns that limited shape with the token validated server-side.
-- Then drop the wide-open shadow.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 1. secure_fetch_student_batchmates(p_student_id, p_token)
-- Returns batchmate rows (across primary + multi-batch) for the
-- student whose token is presented. Limited to safe display fields.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_fetch_student_batchmates(
  p_student_id BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS TABLE (
  id          BIGINT,
  name        TEXT,
  "position"  TEXT,
  photo_url   TEXT,
  status      TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a               RECORD;
  v_primary_batch BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- A student may only request their own batchmates. Staff/owner may
  -- request any student in their academy.
  IF a.actor_kind = 'student' AND a.actor_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'forbidden: students may only fetch their own batchmates'
      USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind IN ('staff', 'owner') THEN
    -- Ensure target student is in actor's academy
    IF NOT EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = p_student_id AND s.academy_id = a.academy_id
    ) THEN
      RAISE EXCEPTION 'forbidden: student not in your academy' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT batch_id INTO v_primary_batch FROM students WHERE id = p_student_id;

  RETURN QUERY
    WITH batch_ids AS (
      SELECT v_primary_batch AS batch_id WHERE v_primary_batch IS NOT NULL
      UNION
      SELECT sb.batch_id FROM student_batches sb WHERE sb.student_id = p_student_id
    ),
    primary_mates AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      WHERE s.batch_id IN (SELECT batch_id FROM batch_ids)
        AND COALESCE(s.status, '') <> 'Deleted'
    ),
    secondary_mates AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      JOIN student_batches sb ON sb.student_id = s.id
      WHERE sb.batch_id IN (SELECT batch_id FROM batch_ids)
        AND COALESCE(s.status, '') <> 'Deleted'
    )
    SELECT DISTINCT id, name, position, photo_url, status
    FROM (
      SELECT * FROM primary_mates
      UNION
      SELECT * FROM secondary_mates
    ) all_mates
    ORDER BY name;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_fetch_student_batchmates(BIGINT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. secure_fetch_batch_students(p_batch_id, p_token)
-- Same shape as above but takes a batch_id (used by staff/coach
-- session-planner views and fallback when a student has no primary
-- batch set).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_fetch_batch_students(
  p_batch_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS TABLE (
  id          BIGINT,
  name        TEXT,
  "position"  TEXT,
  photo_url   TEXT,
  status      TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a              RECORD;
  v_batch_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_batch_academy FROM batches WHERE id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: batch not in your academy' USING ERRCODE = '42501';
  END IF;

  -- A student may only fetch students from a batch they themselves are in
  IF a.actor_kind = 'student' THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE id = a.actor_id AND batch_id = p_batch_id
      UNION
      SELECT 1 FROM student_batches WHERE student_id = a.actor_id AND batch_id = p_batch_id
    ) THEN
      RAISE EXCEPTION 'forbidden: not enrolled in that batch' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
    WITH primary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      WHERE s.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    ),
    secondary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      JOIN student_batches sb ON sb.student_id = s.id
      WHERE sb.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    )
    SELECT DISTINCT id, name, position, photo_url, status
    FROM (
      SELECT * FROM primary_in_batch
      UNION
      SELECT * FROM secondary_in_batch
    ) all_in_batch
    ORDER BY name;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_fetch_batch_students(BIGINT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. Drop the wide-open shadow on students.
-- After this drop, students_anon_read (already in place) is the only
-- anon SELECT policy. It allows:
--   - staff:    rows where academy_id = current_staff_academy()
--   - student:  only the row where id = current_student_id()
-- Batchmate access now goes through the two RPCs above.
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS students_anon_select ON public.students;

COMMIT;
