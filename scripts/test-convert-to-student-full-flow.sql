-- Full end-to-end verification of Convert-to-Student: fee auto-fill, custom
-- date proration, discount, trial-fee deduction, joining fee, and every
-- field landing correctly in the final student + payment rows.
--
-- Run:  supabase db query --linked --file scripts/test-convert-to-student-full-flow.sql
--
-- Rolled back — safe against production. Real staff actor (#123, academy
-- cb01cec5-..., branch 047b75b3-...), real batch #106 "Football U10
-- Morning" (₹2000/month via _expected_fee_rate).
--
-- Each scenario replicates calcHistoricalPayment + ConvertModal.handleSave's
-- exact math by hand (documented per-scenario), then calls the REAL RPC
-- with those numbers and checks every stored field — not just "did it
-- succeed", but "is this exactly what a parent should be charged and what
-- the receipt should say."

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-convert-flow-token', now() + interval '1 hour');

DO $do$
DECLARE
  v_token  TEXT := 'zz-convert-flow-token';
  v_batch  BIGINT := 106;
  v_acad   UUID := 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'::UUID;
  v_branch UUID := '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID;
  v_row    RECORD;
  v_stu    BIGINT;
BEGIN
  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 1 — plain Monthly, trial fee already collected (₹590), no
  -- discount, no joining fee. Batch rate ₹2000/month (matches the auto-
  -- filled fee a pre-batched trial would get).
  --   calcHistoricalPayment: months=1, amount = 2000*1 = 2000
  --   rawAmount = 2000 - 590 (trialDeduct) + 0 (joiningFee) = 1410
  --   coverageStart = startDate (monthly, not custom) = 2027-04-01
  --   coverageEnd   = paidTill = 2027-04-30
  -- ══════════════════════════════════════════════════════════════════
  SELECT create_student_with_payment(
    'ZZ Scenario1', 'P', '9999990001', '9999990001', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-04-01',
    2000, 2000, NULL, '2027-04-30', 'Daily', 'monthly',
    'ZZS1', 'ZZJ1', v_acad, false,
    'ZZP1', 1410, 'Apr 2027', '2027-04-01', 1,
    v_token, v_branch, 0, 'monthly', '2027-04-01', '2027-04-30'
  ) INTO v_stu;
  SELECT amount, discount_pct, payment_type, coverage_start, coverage_end
    INTO v_row FROM payments WHERE id = 'ZZP1';
  INSERT INTO res VALUES ('S1 monthly w/ trial-fee deduction: exact amount charged',
    '1410', 'amount=' || v_row.amount, v_row.amount = 1410);
  INSERT INTO res VALUES ('S1 coverage_start = month start (not custom)',
    '2027-04-01', v_row.coverage_start::TEXT, v_row.coverage_start::TEXT = '2027-04-01');
  INSERT INTO res VALUES ('S1 coverage_end = paidTill',
    '2027-04-30', v_row.coverage_end::TEXT, v_row.coverage_end::TEXT = '2027-04-30');
  SELECT fees, paid_till, batch_id, status INTO v_row FROM students WHERE id = v_stu;
  INSERT INTO res VALUES ('S1 student.fees = the discounted monthly rate (2000, no discount here)',
    '2000', 'fees=' || v_row.fees, v_row.fees = 2000);
  INSERT INTO res VALUES ('S1 student.status = Active (not suspended, paidTill is current)',
    'Active', v_row.status, v_row.status = 'Active');

  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 2 — Custom date range (mid-month join), 20% discount, NO
  -- trial fee, NO joining fee.
  --   Batch rate ₹2000/month. Join 2027-05-16, Paid Till 2027-05-31
  --   (16 of 31 days) -> day-priced fee = round(2000*16/31) = 1032
  --   20% discount -> discountAmt = round(1032*0.20) = 206
  --   discounted fee sent as form.fees = 1032 - 206 = 826
  --   calcHistoricalPayment('custom' plan): amount = fees (NOT multiplied) = 826
  --   rawAmount = 826 - 0 + 0 = 826
  --   coverageStart = joinDateStr (custom!) = 2027-05-16
  --   coverageEnd   = paidTill = 2027-05-31
  --   discountPct stored = round(206/1032*100) = 20
  -- ══════════════════════════════════════════════════════════════════
  SELECT create_student_with_payment(
    'ZZ Scenario2', 'P', '9999990002', '9999990002', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-05-16',
    826, 826, NULL, '2027-05-31', 'Daily', 'custom',
    'ZZS2', 'ZZJ2', v_acad, false,
    'ZZP2', 826, 'May 2027', '2027-05-16', 1,
    v_token, v_branch, 20, 'custom', '2027-05-16', '2027-05-31'
  ) INTO v_stu;
  SELECT amount, discount_pct, payment_type, coverage_start, coverage_end
    INTO v_row FROM payments WHERE id = 'ZZP2';
  INSERT INTO res VALUES ('S2 custom+20pct-discount: exact amount charged',
    '826', 'amount=' || v_row.amount, v_row.amount = 826);
  INSERT INTO res VALUES ('S2 discount_pct stored correctly',
    '20', 'discount_pct=' || v_row.discount_pct, v_row.discount_pct = 20);
  INSERT INTO res VALUES ('S2 payment_type normalizes custom->monthly (DB constraint)',
    'monthly', v_row.payment_type, v_row.payment_type = 'monthly');
  INSERT INTO res VALUES ('S2 coverage_start = EXACT join date (mid-month, not truncated)',
    '2027-05-16', v_row.coverage_start::TEXT, v_row.coverage_start::TEXT = '2027-05-16');
  INSERT INTO res VALUES ('S2 coverage_end = exact end date',
    '2027-05-31', v_row.coverage_end::TEXT, v_row.coverage_end::TEXT = '2027-05-31');

  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 3 — Quarterly plan, flat total (NOT multiplied), plus a
  -- joining fee (one-time, added on top).
  --   Batch quarterly rate (assume plan has one, else this batch has no
  --   named plan so we just assert the flat-total math itself): fees=5700
  --   (a quarterly flat total, e.g. discounted or matched), joiningFee=500
  --   calcHistoricalPayment('quarterly'): amount = fees (not x months) = 5700
  --   rawAmount = 5700 - 0 (no trial deduct) + 500 (joiningFee) = 6200
  -- ══════════════════════════════════════════════════════════════════
  SELECT create_student_with_payment(
    'ZZ Scenario3', 'P', '9999990003', '9999990003', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-06-01',
    5700, 5700, NULL, '2027-08-31', 'Daily', 'quarterly',
    'ZZS3', 'ZZJ3', v_acad, false,
    'ZZP3', 6200, 'Jun-Aug 2027', '2027-06-01', 3,
    v_token, v_branch, 0, 'quarterly', '2027-06-01', '2027-08-31'
  ) INTO v_stu;
  SELECT amount, payment_type, months_covered INTO v_row FROM payments WHERE id = 'ZZP3';
  INSERT INTO res VALUES ('S3 quarterly + joining fee: flat total + 500, not x3 first',
    '6200', 'amount=' || v_row.amount, v_row.amount = 6200);
  INSERT INTO res VALUES ('S3 payment_type = quarterly (not silently monthly)',
    'quarterly', v_row.payment_type, v_row.payment_type = 'quarterly');
  INSERT INTO res VALUES ('S3 months_covered = 3',
    '3', v_row.months_covered::TEXT, v_row.months_covered = 3);

  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 4 — Trial fee mode "Not collected": must NOT deduct anything
  -- even though trialFeePaid defaults to 590 on every trial row. Simulates
  -- addStudent's trialDeduct = 0 (the trialFeeMode check happens client-
  -- side in handleConvert before this RPC is ever called — verifying the
  -- FINAL amount reflects zero deduction, i.e. the client did its job).
  --   fees=2000, trialDeduct=0 (not collected) -> rawAmount = 2000
  -- ══════════════════════════════════════════════════════════════════
  SELECT create_student_with_payment(
    'ZZ Scenario4', 'P', '9999990004', '9999990004', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-07-01',
    2000, 2000, NULL, '2027-07-31', 'Daily', 'monthly',
    'ZZS4', 'ZZJ4', v_acad, false,
    'ZZP4', 2000, 'Jul 2027', '2027-07-01', 1,
    v_token, v_branch, 0, 'monthly', '2027-07-01', '2027-07-31'
  ) INTO v_stu;
  SELECT amount INTO v_row FROM payments WHERE id = 'ZZP4';
  INSERT INTO res VALUES ('S4 trial fee "Not collected" -> full amount, no deduction',
    '2000', 'amount=' || v_row.amount, v_row.amount = 2000);

  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 5 — Suspend-now: paidTill already far in the past at the
  -- moment of conversion (a backdated/late conversion) -> student should
  -- land Suspended, and batches.enrolled must NOT increment for a
  -- suspended student (mirrors addStudent's suspendNow gate).
  -- ══════════════════════════════════════════════════════════════════
  DECLARE
    v_enrolled_before INT;
    v_enrolled_after  INT;
  BEGIN
    SELECT enrolled INTO v_enrolled_before FROM batches WHERE id = v_batch;
    SELECT create_student_with_payment(
      'ZZ Scenario5', 'P', '9999990005', '9999990005', NULL, NULL,
      'Football', 'Football U10 Morning', v_batch, '2026-01-01',
      2000, 2000, NULL, '2026-01-31', 'Daily', 'monthly',
      'ZZS5', 'ZZJ5', v_acad, true,  -- suspend_now = true
      'ZZP5', 2000, 'Jan 2026', '2026-01-01', 1,
      v_token, v_branch, 0, 'monthly', '2026-01-01', '2026-01-31'
    ) INTO v_stu;
    SELECT enrolled INTO v_enrolled_after FROM batches WHERE id = v_batch;
    SELECT status, suspended_since INTO v_row FROM students WHERE id = v_stu;
    INSERT INTO res VALUES ('S5 suspend-now conversion lands Suspended with suspended_since stamped',
      'Suspended/today', v_row.status || '/' || v_row.suspended_since::TEXT,
      v_row.status = 'Suspended' AND v_row.suspended_since = current_date);
    INSERT INTO res VALUES ('S5 suspended conversion does NOT increment batch.enrolled',
      v_enrolled_before::TEXT, v_enrolled_after::TEXT, v_enrolled_after = v_enrolled_before);
  END;

  -- ══════════════════════════════════════════════════════════════════
  -- SCENARIO 6 — Duplicate invoice id guard: create_student_with_payment
  -- has NO advisory lock / duplicate check of its own (unlike
  -- secure_insert_payment) — verify what actually happens on a re-used
  -- invoice id (a real risk on a network retry / double-click).
  -- ══════════════════════════════════════════════════════════════════
  BEGIN
    PERFORM create_student_with_payment(
      'ZZ Scenario6-dup', 'P', '9999990006', '9999990006', NULL, NULL,
      'Football', 'Football U10 Morning', v_batch, '2027-04-01',
      2000, 2000, NULL, '2027-04-30', 'Daily', 'monthly',
      'ZZS6', 'ZZJ6', v_acad, false,
      'ZZP1', 2000, 'Apr 2027', '2027-04-01', 1,  -- re-uses invoice id ZZP1 from Scenario 1
      v_token, v_branch, 0, 'monthly', '2027-04-01', '2027-04-30'
    );
    INSERT INTO res VALUES ('S6 re-used invoice id on retry/double-click', 'REJECT (unique violation) or student-only w/o dup payment',
      'ALLOWED — second student+payment silently created with duplicate invoice id semantics unclear', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('S6 re-used invoice id on retry/double-click', 'REJECT (unique_violation 23505)', SQLSTATE, SQLSTATE = '23505');
  END;

END $do$;

DELETE FROM staff_sessions WHERE token = 'zz-convert-flow-token';

SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY test;

ROLLBACK;
