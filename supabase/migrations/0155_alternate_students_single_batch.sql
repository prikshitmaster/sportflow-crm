-- 0155 — Alternate-day students may hold only ONE batch
--
-- WHY
--   Batches at this academy come in MWF / TTS pairs at the same time slot, so
--   holding one of each means training six days a week. That is exactly what a
--   'Daily' student pays for, and a Daily student in two batches is correct and
--   is billed ONCE (fees live on students, never on batches).
--
--   An 'Alternate' student pays the alternate-day rate for three days a week.
--   Letting them hold both halves of a pair gives them daily training on an
--   alternate-day fee. This migration makes that impossible at the RPC layer,
--   which is where enrolment is really enforced (the UI check is only a
--   courtesy — see Batches.jsx).
--
-- WHAT IT DOES NOT DO
--   * No data change. Two suspended Alternate students already hold two
--     batches; they are left exactly as they are. Reactivating one will NOT
--     retro-fail — the guard fires on assignment, not on read.
--   * Does not block MOVING an Alternate student between batches. Moving is
--     reassignStudentBatch / secure_unassign + assign, and at the moment of the
--     assign the student holds no other batch, so the guard stays quiet.
--   * Does not block re-assigning to a batch the student is already in — that
--     path is the ON CONFLICT rename below and must stay a no-op.
--
-- CASING
--   students.training_type is stored capitalised ('Daily' / 'Alternate') while
--   fee_plans.training_type is lower-case. Always normalise before comparing —
--   a strict equality check here would silently never fire. Same trap that
--   normTrainingType() in src/lib/studentRules.js exists to solve.
--
-- ROLLBACK
--   Re-run supabase/security-v3/02_branch_writes_core.sql, which holds the
--   previous definition of this function verbatim.

BEGIN;

CREATE OR REPLACE FUNCTION secure_assign_student_to_batch(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_batch_name TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_batch_branch    UUID;
  v_training_type   TEXT;
  v_other_batches   INT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id, training_type
    INTO v_student_academy, v_student_branch, v_training_type
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  -- Also block enrolling into a batch from a different branch
  SELECT branch_id INTO v_batch_branch FROM batches WHERE id = p_batch_id;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  -- ── Alternate-day students: one batch only ──────────────────────
  -- Counts batches OTHER than the one being assigned, across BOTH sources of
  -- enrolment truth (the primary students.batch_id and the student_batches
  -- rows). Excluding p_batch_id is what keeps a repeat assign to the same
  -- batch a harmless rename instead of an error.
  IF lower(trim(COALESCE(v_training_type, ''))) = 'alternate' THEN
    SELECT count(*) INTO v_other_batches FROM (
      SELECT batch_id FROM student_batches
       WHERE student_id = p_student_id
         AND batch_id IS DISTINCT FROM p_batch_id
      UNION
      SELECT batch_id FROM students
       WHERE id = p_student_id
         AND batch_id IS NOT NULL
         AND batch_id IS DISTINCT FROM p_batch_id
    ) held;

    IF v_other_batches > 0 THEN
      RAISE EXCEPTION
        'Alternate-day students can only be in one batch. Move this student to the new batch instead, or change their training type to Daily first.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
  VALUES (p_student_id, p_batch_id, p_batch_name, a.academy_id)
  ON CONFLICT (student_id, batch_id) DO UPDATE SET
    batch_name = EXCLUDED.batch_name;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_assign_student_to_batch(BIGINT, BIGINT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
