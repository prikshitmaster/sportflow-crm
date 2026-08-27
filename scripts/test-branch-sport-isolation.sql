-- Adversarial branch/sport isolation audit — real staff actor scoped to one
-- branch, trying to touch data in a DIFFERENT branch (different sport too),
-- same academy. Rolled back — safe against production.
--
-- Fixture: staff #123, branch 047b75b3 (Football), academy cb01cec5.
-- Cross-branch targets: batch 138 "Squash U10 Weekend" (branch
-- 6908f0a4), batches 98/99 "Cricket..." (branch 7343796b) — all same
-- academy, different branch AND different sport from staff #123's own.

BEGIN;
CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);
INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-isolation-token', now() + interval '1 hour');

DO $do$
DECLARE
  v_token TEXT := 'zz-isolation-token';
  v_own_branch UUID := '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID;
  v_foreign_batch BIGINT := 138; -- Squash, branch 6908f0a4 — NOT staff #123's branch
  v_acad UUID := 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'::UUID;
  v_row RECORD;
  v_stu BIGINT;
  v_enrolled_before INT;
  v_enrolled_after  INT;
BEGIN
  -- T1. create_student_with_payment: staff creates a student, but passes a
  -- batch_id belonging to a COMPLETELY DIFFERENT branch/sport. The RPC
  -- forces the STUDENT's branch_id to the staff's own branch (correct) —
  -- but does it also verify batch_id belongs to that same branch?
  SELECT enrolled INTO v_enrolled_before FROM batches WHERE id = v_foreign_batch;
  BEGIN
    SELECT create_student_with_payment(
      'ZZ Isolation Test', 'P', '9999991001', '9999991001', NULL, NULL,
      'Squash', 'Squash U10 Weekend', v_foreign_batch, '2027-01-01',
      1000, 1000, NULL, NULL, 'Daily', 'monthly',
      'ZZISO1', 'ZZISOJ1', v_acad, false,
      NULL, NULL, NULL, NULL, NULL,
      v_token, v_own_branch  -- staff passes THEIR OWN branch as p_branch_id
    ) INTO v_stu;
    SELECT branch_id, batch_id INTO v_row FROM students WHERE id = v_stu;
    INSERT INTO res VALUES ('T1 create_student: cross-branch batch_id accepted?',
      'REJECT or student.branch_id must match the batch''s real branch',
      'student.branch_id=' || v_row.branch_id || ' batch_id=' || v_row.batch_id ||
        ' (batch''s REAL branch is 6908f0a4 — mismatch = ' || (v_row.branch_id::TEXT <> '6908f0a4-f2c4-4227-8a74-453219a1a9bd') || ')',
      v_row.branch_id::TEXT = '6908f0a4-f2c4-4227-8a74-453219a1a9bd'); -- only "pass" if it self-corrected; otherwise this documents the gap
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('T1 create_student: cross-branch batch_id accepted?', 'REJECT', SQLSTATE || ': ' || SQLERRM, TRUE);
  END;
  SELECT enrolled INTO v_enrolled_after FROM batches WHERE id = v_foreign_batch;
  INSERT INTO res VALUES ('T1b foreign batch''s enrolled count untouched by this academy-mismatched write',
    v_enrolled_before::TEXT, v_enrolled_after::TEXT, v_enrolled_after = v_enrolled_before);

  -- T2. secure_update_student: reassign an EXISTING student (2872, belongs
  -- to staff #123's own branch/academy) onto a batch from a DIFFERENT
  -- branch/sport (Squash, 138) via reassignStudentBatch's exact minimal
  -- payload shape.
  BEGIN
    PERFORM secure_update_student(2872, jsonb_build_object(
      'batchId', v_foreign_batch, 'batchName', 'Squash U10 Weekend'
    ), v_token);
    SELECT batch_id, sport INTO v_row FROM students WHERE id = 2872;
    INSERT INTO res VALUES ('T2 secure_update_student: cross-branch/sport batch reassignment',
      'REJECT (batch does not belong to student''s branch)',
      'ALLOWED — student 2872 (Football/047b75b3) now has batch_id=' || v_row.batch_id || ' (Squash, branch 6908f0a4) sport field still says ' || v_row.sport,
      FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('T2 secure_update_student: cross-branch/sport batch reassignment',
      'REJECT (batch does not belong to student''s branch)', SQLSTATE || ': ' || SQLERRM, TRUE);
  END;

  -- T3. Sanity: does _require_branch_scope even fire for a plain field
  -- update on a student in staff #123's OWN branch (positive control —
  -- confirms the harness/token itself works before trusting T1/T2's
  -- "no error" readings as meaningful).
  PERFORM secure_update_student(2872, jsonb_build_object('medicalNotes', 'zz isolation test touch'), v_token);
  INSERT INTO res VALUES ('T3 positive control: own-branch student update succeeds', 'ALLOW', 'allowed', TRUE);

END $do$;

DELETE FROM staff_sessions WHERE token = 'zz-isolation-token';
SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY test;
ROLLBACK;
