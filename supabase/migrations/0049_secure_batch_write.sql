-- ============================================================
-- 0049 — Phase 9a: secure batch + student_batches write RPCs
-- ============================================================
-- WHY
--   batches_anon_all + student_batches_anon_all (from 0032) let any
--   anon caller create, modify, or hijack batch enrolments:
--     supabase.from('batches').insert({ name: 'Free Batch', capacity: 999 })
--     supabase.from('student_batches').upsert({ student_id: X, batch_id: Y })
--   This migration adds SECURITY DEFINER RPCs covering all write paths
--   so the raw policies can be dropped in 0050.
--
-- RPCs ADDED
--   1. secure_insert_batch               — owner-only batch creation
--   2. secure_update_batch               — owner-only batch edit (JSONB payload)
--   3. secure_assign_student_to_batch    — enrol student; requires students.manage
--   4. secure_unassign_student_from_batch — remove student; requires students.manage
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_insert_batch ────────────────────────────────
-- Returns the full inserted row as JSON so the JS caller can use it
-- the same way as the previous raw .insert().select().
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_batch(
  p_token        TEXT,
  p_name         TEXT,
  p_time         TEXT       DEFAULT NULL,
  p_sports       JSONB      DEFAULT '[]',
  p_coach        TEXT       DEFAULT NULL,
  p_capacity     INTEGER    DEFAULT 30,
  p_days         JSONB      DEFAULT '[]',
  p_start_time   TEXT       DEFAULT NULL,
  p_end_time     TEXT       DEFAULT NULL,
  p_age_min      INTEGER    DEFAULT 0,
  p_age_max      INTEGER    DEFAULT 99,
  p_ground       TEXT       DEFAULT NULL,
  p_code         TEXT       DEFAULT NULL,
  p_default_fee  INTEGER    DEFAULT 0,
  p_default_plan TEXT       DEFAULT 'monthly',
  p_branch_id    UUID       DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a      RECORD;
  v_row  batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can create batches'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO batches (
    name, time, sports, coach, capacity, enrolled, waitlist,
    days, start_time, end_time, age_min, age_max, ground, code,
    default_fee, default_plan, academy_id, branch_id
  ) VALUES (
    p_name,
    p_time,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    p_coach,
    COALESCE(p_capacity, 30),
    0,
    0,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_days, '[]'::JSONB))),
    p_start_time,
    p_end_time,
    COALESCE(p_age_min, 0),
    COALESCE(p_age_max, 99),
    p_ground,
    p_code,
    COALESCE(p_default_fee, 0),
    COALESCE(p_default_plan, 'monthly'),
    a.academy_id,
    p_branch_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_batch(TEXT, TEXT, TEXT, JSONB, TEXT, INTEGER, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, UUID) TO anon, authenticated;


-- ── 2. secure_update_batch ────────────────────────────────
-- JSONB payload; CASE WHEN per field so absent fields are untouched.
-- Covers updateBatch (full edit), updateBatchFee, updateBatchCoach.
-- Returns updated row as JSON.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_batch(
  p_batch_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a              RECORD;
  v_batch_academy UUID;
  v_row          batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can edit batches'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_batch_academy FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy batch edit' USING ERRCODE = '42501';
  END IF;

  UPDATE batches SET
    name         = CASE WHEN p_payload ? 'name'        THEN p_payload->>'name'                            ELSE name         END,
    time         = CASE WHEN p_payload ? 'time'        THEN p_payload->>'time'                            ELSE time         END,
    sports       = CASE WHEN p_payload ? 'sports'      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'sports')) ELSE sports       END,
    coach        = CASE WHEN p_payload ? 'coach'       THEN p_payload->>'coach'                           ELSE coach        END,
    capacity     = CASE WHEN p_payload ? 'capacity'    THEN (p_payload->>'capacity')::INTEGER             ELSE capacity     END,
    days         = CASE WHEN p_payload ? 'days'        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'days'))   ELSE days         END,
    start_time   = CASE WHEN p_payload ? 'startTime'   THEN NULLIF(p_payload->>'startTime', '')           ELSE start_time   END,
    end_time     = CASE WHEN p_payload ? 'endTime'     THEN NULLIF(p_payload->>'endTime', '')             ELSE end_time     END,
    age_min      = CASE WHEN p_payload ? 'ageMin'      THEN COALESCE((p_payload->>'ageMin')::INTEGER, 0) ELSE age_min      END,
    age_max      = CASE WHEN p_payload ? 'ageMax'      THEN COALESCE((p_payload->>'ageMax')::INTEGER, 99) ELSE age_max     END,
    ground       = CASE WHEN p_payload ? 'ground'      THEN NULLIF(p_payload->>'ground', '')              ELSE ground       END,
    code         = CASE WHEN p_payload ? 'code'        THEN NULLIF(p_payload->>'code', '')               ELSE code         END,
    default_fee  = CASE WHEN p_payload ? 'defaultFee'  THEN COALESCE((p_payload->>'defaultFee')::INTEGER, 0)  ELSE default_fee  END,
    default_plan = CASE WHEN p_payload ? 'defaultPlan' THEN COALESCE(p_payload->>'defaultPlan', 'monthly')    ELSE default_plan END
  WHERE id = p_batch_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_batch(BIGINT, JSONB, TEXT) TO anon, authenticated;


-- ── 3. secure_assign_student_to_batch ────────────────────
-- UPSERT into student_batches. Requires students.manage.
-- Academy scope: student must belong to caller's academy.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_assign_student_to_batch(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_batch_name TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
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

  INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
  VALUES (p_student_id, p_batch_id, p_batch_name, a.academy_id)
  ON CONFLICT (student_id, batch_id) DO UPDATE SET
    batch_name = EXCLUDED.batch_name;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_assign_student_to_batch(BIGINT, BIGINT, TEXT, TEXT) TO anon, authenticated;


-- ── 4. secure_unassign_student_from_batch ────────────────
-- DELETE from student_batches. Requires students.manage.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_unassign_student_from_batch(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
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

  DELETE FROM student_batches
  WHERE student_id = p_student_id AND batch_id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_unassign_student_from_batch(BIGINT, BIGINT, TEXT) TO anon, authenticated;
