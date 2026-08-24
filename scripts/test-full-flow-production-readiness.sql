-- Production-readiness pass over every feature shipped in this session's
-- final stretch: partial-payment due-balance flow, suspend/inactive/remove-
-- from-batch/reactivate lifecycle, and the branch-settings round trip.
--
-- Run:  supabase db query --linked --file scripts/test-full-flow-production-readiness.sql
--
-- Everything happens inside a transaction that ROLLS BACK — safe against
-- production. A staff session token is forged (rolled back with everything
-- else) to call every RPC as a REAL authenticated actor, exactly like the
-- app does.
--
-- Fixture: real staff #123 (payments.manage + students.manage, academy
-- cb01cec5-..., branch 047b75b3-...) and real student #2872 (Active, batch
-- 106 "Football U10 Morning", branch default rate ₹2000/month via
-- _expected_fee_rate — same fixture as test-payment-integrity.sql).

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-test-token-full-flow', now() + interval '1 hour');

DO $do$
DECLARE
  v_token       TEXT := 'zz-test-token-full-flow';
  v_student     BIGINT := 2872;
  v_batch       BIGINT := 106;
  v_enrolled0   INT;
  v_enrolled1   INT;
  v_enrolled2   INT;
  v_row         RECORD;
  v_msg         TEXT;
BEGIN
  SELECT enrolled INTO v_enrolled0 FROM batches WHERE id = v_batch;

  -- ══════════════════════════════════════════════════════════════════
  -- 1. PAYMENT FLOW — partial payment + linked due-balance + clear it
  -- ══════════════════════════════════════════════════════════════════

  -- 1a. Main partial payment (₹1200 of ₹2000 expected) — dueAmount>0 on
  --     THIS row already exempts it from the mismatch check on its own.
  PERFORM secure_insert_payment(
    jsonb_build_object(
      'id', 'ZZFLOW-1', 'studentId', v_student, 'student', 'ZZ Flow Test',
      'amount', 1200, 'month', 'Feb 2027', 'paymentType', 'monthly',
      'monthsCovered', 1, 'coverageStart', '2027-02-01', 'dueAmount', 800,
      'status', 'Paid', 'notes', 'ZZFLOW partial'
    ), v_token);
  INSERT INTO res VALUES ('1a. partial payment (dueAmount=800) succeeds', 'ALLOW', 'allowed', TRUE);

  -- 1b. REGRESSION GUARD — the linked due-balance row's OWN amount (800)
  --     is ~60% off the ₹2000 expected rate. Without confirmedMismatch it
  --     must still be REJECTED — this is the exact bug fixed this session
  --     (0bfc934); if this ever starts passing, the fix regressed.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZFLOW-2-SHOULD-FAIL', 'studentId', v_student, 'student', 'ZZ Flow Test',
        'amount', 800, 'month', 'Feb 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'status', 'Pending', 'notes', 'Balance due — no confirmedMismatch'
      ), v_token);
    INSERT INTO res VALUES ('1b. due-balance row WITHOUT confirmedMismatch still rejected', 'REJECT (23514)', 'ALLOWED — REGRESSION', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('1b. due-balance row WITHOUT confirmedMismatch still rejected', 'REJECT (23514)', SQLSTATE || ': ' || left(v_msg, 40),
      SQLSTATE = '23514');
  END;

  -- 1c. The actual fix — same shortfall row, confirmedMismatch=true, must succeed.
  PERFORM secure_insert_payment(
    jsonb_build_object(
      'id', 'ZZFLOW-2', 'studentId', v_student, 'student', 'ZZ Flow Test',
      'amount', 800, 'month', 'Feb 2027', 'paymentType', 'monthly',
      'monthsCovered', 1, 'status', 'Pending', 'confirmedMismatch', true,
      'notes', 'Balance due from ZZFLOW-1 (₹1200 of ₹2000 paid)'
    ), v_token);
  INSERT INTO res VALUES ('1c. linked due-balance row WITH confirmedMismatch succeeds', 'ALLOW', 'allowed', TRUE);

  SELECT status, amount INTO v_row FROM payments WHERE id = 'ZZFLOW-2';
  INSERT INTO res VALUES ('1d. linked row lands as Pending ₹800', 'Pending/800',
    v_row.status || '/' || v_row.amount, v_row.status = 'Pending' AND v_row.amount = 800);

  -- 1e. Clear the due balance — the "Clear now" action's underlying call.
  PERFORM secure_update_payment('ZZFLOW-2', jsonb_build_object('status', 'Paid', 'mode', 'Cash', 'date', current_date), v_token);
  SELECT status INTO v_row FROM (SELECT status FROM payments WHERE id = 'ZZFLOW-2') x;
  INSERT INTO res VALUES ('1e. Clear now flips linked row to Paid', 'Paid', v_row.status, v_row.status = 'Paid');

  -- ══════════════════════════════════════════════════════════════════
  -- 2. SUSPEND → INACTIVE (backdate) → REMOVE FROM BATCH → REACTIVATE
  -- ══════════════════════════════════════════════════════════════════

  -- 2a. Suspend (mirrors AppContext.suspendStudent: secure_update_student + bump_batch_enrolled)
  PERFORM secure_update_student(v_student, jsonb_build_object('status', 'Suspended', 'suspendedSince', current_date), v_token);
  PERFORM bump_batch_enrolled(v_batch, -1);
  SELECT enrolled INTO v_enrolled1 FROM batches WHERE id = v_batch;
  INSERT INTO res VALUES ('2a. suspend decrements batch.enrolled by 1', (v_enrolled0 - 1)::TEXT, v_enrolled1::TEXT, v_enrolled1 = v_enrolled0 - 1);

  SELECT status, suspended_since INTO v_row FROM (SELECT status, suspended_since FROM students WHERE id = v_student) x;
  INSERT INTO res VALUES ('2b. student flips to Suspended with suspended_since stamped', 'Suspended/today',
    v_row.status || '/' || v_row.suspended_since::TEXT, v_row.status = 'Suspended' AND v_row.suspended_since = current_date);

  -- 2c. Backdate suspended_since 61 days — the Students.jsx client-side split
  --     (recentlySuspended vs inactiveStudents) uses `suspendedSince < today-60days`.
  --     Can't execute React here, but the underlying data + comparison is what
  --     that split runs on — verify the date itself lands correctly.
  PERFORM secure_update_student(v_student, jsonb_build_object('suspendedSince', (current_date - interval '61 days')::DATE), v_token);
  SELECT suspended_since INTO v_row FROM (SELECT suspended_since FROM students WHERE id = v_student) x;
  INSERT INTO res VALUES ('2c. suspended_since backdates to 61 days ago', (current_date - interval '61 days')::DATE::TEXT,
    v_row.suspended_since::TEXT, v_row.suspended_since = (current_date - interval '61 days')::DATE);
  INSERT INTO res VALUES ('2d. 61-day-old suspension would classify as Inactive (60-day default)', 'TRUE',
    (v_row.suspended_since < (current_date - interval '60 days')::DATE)::TEXT,
    v_row.suspended_since < (current_date - interval '60 days')::DATE);

  -- 2e. Remove from Batch — db.removeStudentFromBatch(studentId, lastBatchId, lastBatchName)
  --     path (migration 0191). Must NOT touch batches.enrolled a second time
  --     (already freed at 2a), and MUST stamp last_batch_name/last_batch_id
  --     so "Last Batch" keeps working — this is the exact gap found by the
  --     first run of this test (last_batch_name was never written by any
  --     client-side path before 0191).
  PERFORM secure_update_student(v_student, jsonb_build_object(
    'batchId', NULL, 'batchName', '', 'lastBatchId', v_batch, 'lastBatchName', 'Football U10 Morning'
  ), v_token);
  SELECT batch_id, batch, last_batch_name, last_batch_id INTO v_row
    FROM (SELECT batch_id, batch, last_batch_name, last_batch_id FROM students WHERE id = v_student) x;
  INSERT INTO res VALUES ('2f. Remove from Batch clears batch_id/batch', 'NULL/empty',
    COALESCE(v_row.batch_id::TEXT,'NULL') || '/' || quote_literal(v_row.batch), v_row.batch_id IS NULL AND v_row.batch = '');
  INSERT INTO res VALUES ('2g. Remove from Batch stamps last_batch_name/last_batch_id', 'Football U10 Morning/106',
    COALESCE(v_row.last_batch_name,'NULL') || '/' || COALESCE(v_row.last_batch_id::TEXT,'NULL'),
    v_row.last_batch_name = 'Football U10 Morning' AND v_row.last_batch_id = v_batch);

  SELECT enrolled INTO v_enrolled2 FROM batches WHERE id = v_batch;
  INSERT INTO res VALUES ('2h. Remove from Batch does NOT double-decrement enrolled', v_enrolled1::TEXT, v_enrolled2::TEXT, v_enrolled2 = v_enrolled1);

  -- 2i. Reactivate (batchless — matches real reactivateStudent() when student.batchId is null)
  PERFORM secure_update_student(v_student, jsonb_build_object('status', 'Active', 'suspendedSince', NULL), v_token);
  SELECT status, suspended_since, batch_id INTO v_row FROM (SELECT status, suspended_since, batch_id FROM students WHERE id = v_student) x;
  INSERT INTO res VALUES ('2j. Reactivate flips to Active, clears suspended_since, stays batchless', 'Active/NULL/NULL',
    v_row.status || '/' || COALESCE(v_row.suspended_since::TEXT,'NULL') || '/' || COALESCE(v_row.batch_id::TEXT,'NULL'),
    v_row.status = 'Active' AND v_row.suspended_since IS NULL AND v_row.batch_id IS NULL);

  -- ══════════════════════════════════════════════════════════════════
  -- 3. BRANCH SETTINGS ROUND-TRIP (ghost_min_sessions, inactive_after_days,
  --    all the earlier toggles) — the exact 12-arg RPC the Settings page calls.
  -- ══════════════════════════════════════════════════════════════════

  -- Branch 047b75b3 has no manager_id set today (owner-only) — temporarily
  -- make staff #123 its manager so this sub-test is self-contained rather
  -- than depending on which staff happens to manage which branch today.
  -- Rolled back with everything else.
  UPDATE sport_branches SET manager_id = 123 WHERE id = '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID;

  PERFORM secure_update_branch_fees(
    '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID,
    500, 200, 18, true, false, true, 'calendar', false, 3, 45, v_token
  );
  SELECT ghost_min_sessions, inactive_after_days, auto_calc_payment_dates, trial_fee, kit_fee
    INTO v_row FROM (SELECT ghost_min_sessions, inactive_after_days, auto_calc_payment_dates, trial_fee, kit_fee
                      FROM sport_branches WHERE id = '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID) x;
  INSERT INTO res VALUES ('3a. branch settings round-trip (ghost=3, inactive=45, autoCalc=false)', '3/45/false',
    v_row.ghost_min_sessions || '/' || v_row.inactive_after_days || '/' || v_row.auto_calc_payment_dates,
    v_row.ghost_min_sessions = 3 AND v_row.inactive_after_days = 45 AND v_row.auto_calc_payment_dates = false);

  -- 3b. Reject invalid inactive_after_days (< 1)
  BEGIN
    PERFORM secure_update_branch_fees(
      '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, v_token
    );
    INSERT INTO res VALUES ('3c. inactive_after_days=0 rejected', 'REJECT (23514)', 'ALLOWED', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('3c. inactive_after_days=0 rejected', 'REJECT (23514)', SQLSTATE, SQLSTATE = '23514');
  END;

END $do$;

DELETE FROM staff_sessions WHERE token = 'zz-test-token-full-flow';

-- NOT pass excludes NULL pass (an assertion that itself errored/was
-- miscomputed) as well as FALSE — a NULL must count as a failure, not
-- silently vanish from the tally.
SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY test;

ROLLBACK;
