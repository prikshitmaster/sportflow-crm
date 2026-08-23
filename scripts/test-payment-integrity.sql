-- Adversarial test suite for migration 0188 (payment integrity hardening):
-- duplicate-payment race, late-fee floor, mismatch enforcement, tax storage.
--
-- Run:  supabase db query --linked --file scripts/test-payment-integrity.sql
--
-- Everything happens inside a transaction that ROLLS BACK — safe against
-- production. A staff session token is forged (INSERT into staff_sessions,
-- rolled back with everything else) to call secure_insert_payment as a
-- REAL authenticated actor, exactly like the app does — this exercises the
-- actual RPC, not a bypass of it.
--
-- Fixture: real staff #123 (payments.manage, academy cb01cec5-...) and
-- real student #2872 (batch 106, training_type 'Daily', batch default fee
-- ₹2000/month, no fee_plans row — so _expected_fee_rate falls through to
-- the batch default, exactly the path most academies are actually on).

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-test-token-payment-integrity', now() + interval '1 hour');

DO $do$
DECLARE
  v_token   TEXT := 'zz-test-token-payment-integrity';
  v_student BIGINT := 2872;
  v_msg     TEXT;
  v_hint    TEXT;
BEGIN
  -- ── 1. A normal payment succeeds ──────────────────────────────────────
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-1', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2000, 'month', 'Jan 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-01-01'
      ), v_token);
    INSERT INTO res VALUES ('normal payment at expected rate succeeds', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('normal payment at expected rate succeeds', 'ALLOW', v_msg, FALSE);
  END;

  -- ── 2. THE race, made atomic: an identical payment (same student,
  -- amount, coverage_start) within 60s must now be rejected by the SERVER,
  -- not just a client-side check that a direct RPC call could skip.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-2', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2000, 'month', 'Jan 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-01-01'
      ), v_token);
    INSERT INTO res VALUES ('duplicate (same student/amount/period) rejected server-side', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    INSERT INTO res VALUES ('duplicate (same student/amount/period) rejected server-side', 'duplicate_payment', COALESCE(v_hint,'(null)'), v_hint = 'duplicate_payment');
  END;

  -- A different period for the SAME student/amount is NOT a duplicate —
  -- catching up two different months' worth of the same fee must still work.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-3', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2000, 'month', 'Feb 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-02-01'
      ), v_token);
    INSERT INTO res VALUES ('same amount, DIFFERENT period, is not a duplicate', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('same amount, DIFFERENT period, is not a duplicate', 'ALLOW', v_msg, FALSE);
  END;

  -- ── 3. Negative late fee rejected (closes the discount-cap bypass) ────
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-4', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 1, 'month', 'Mar 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-03-01', 'lateFee', -1999
      ), v_token);
    INSERT INTO res VALUES ('negative late fee rejected', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO res VALUES ('negative late fee rejected', 'REJECT', 'check_violation', TRUE);
  END;

  -- Positive late fee is fine and stored.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-5', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2100, 'month', 'Mar 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-03-01', 'lateFee', 100
      ), v_token);
    INSERT INTO res
      SELECT 'positive late fee stored correctly', '100', late_fee::TEXT, late_fee = 100
        FROM payments WHERE id = 'ZZTEST-5';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('positive late fee stored correctly', '100', v_msg, FALSE);
  END;

  -- ── 4. Wild mismatch (₹100 against a ₹2000 expected rate), no
  -- explanation at all — this is the "unexplained wild amount from a
  -- direct API call" the CONFIRM gate was supposed to stop but couldn't.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-6', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 100, 'month', 'Apr 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-04-01'
      ), v_token);
    INSERT INTO res VALUES ('wild mismatch with no explanation rejected', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    INSERT INTO res VALUES ('wild mismatch with no explanation rejected', 'amount_mismatch', COALESCE(v_hint,'(null)'), v_hint = 'amount_mismatch');
  END;

  -- SAME wild amount, but properly declared as a partial payment
  -- (dueAmount tracks the ₹1900 shortfall) — must succeed untouched.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-7', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 100, 'month', 'Apr 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-04-01', 'dueAmount', 1900
      ), v_token);
    INSERT INTO res VALUES ('same wild amount, properly a PARTIAL payment, allowed', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('same wild amount, properly a PARTIAL payment, allowed', 'ALLOW', v_msg, FALSE);
  END;

  -- SAME wild amount for a DIFFERENT period, with confirmedMismatch (the
  -- UI's "type CONFIRM" path) — must succeed.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-8', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 100, 'month', 'May 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-05-01', 'confirmedMismatch', true
      ), v_token);
    INSERT INTO res VALUES ('same wild amount, CONFIRMED by staff, allowed', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('same wild amount, CONFIRMED by staff, allowed', 'ALLOW', v_msg, FALSE);
  END;

  -- 'custom' paymentType (N months upfront at the monthly rate) is NOT
  -- exempt from the check — it normalizes to 'monthly' server-side (same as
  -- the client, which prices it as baseAmount x months) and gets evaluated
  -- the same way. A reasonable amount for 3 "custom" months at the ₹2000
  -- rate must pass...
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-9', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 6000, 'month', 'Jun 2027', 'paymentType', 'custom',
        'monthsCovered', 3, 'coverageStart', '2027-06-01'
      ), v_token);
    INSERT INTO res VALUES ('custom (N months @ monthly rate) at the right amount is allowed', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('custom (N months @ monthly rate) at the right amount is allowed', 'ALLOW', v_msg, FALSE);
  END;

  -- ...but a wild amount for that same 'custom' type, with no
  -- justification, is correctly still caught — 'custom' is a billing
  -- SHAPE (N months upfront), not a blanket exemption from sanity-checking.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-9B', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 50, 'month', 'Sep 2027', 'paymentType', 'custom',
        'monthsCovered', 1, 'coverageStart', '2027-09-01'
      ), v_token);
    INSERT INTO res VALUES ('custom type does NOT exempt a genuinely wild amount', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    INSERT INTO res VALUES ('custom type does NOT exempt a genuinely wild amount', 'amount_mismatch', COALESCE(v_hint,'(null)'), v_hint = 'amount_mismatch');
  END;

  -- ── 5. Tax storage — a normal payment with an 18% tax breakdown ───────
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-10', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2360, 'month', 'Jul 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-07-01',
        'taxPercent', 18, 'taxAmount', 360
      ), v_token);
    INSERT INTO res
      SELECT 'tax_percent/tax_amount stored correctly', '18/360',
             tax_percent::TEXT || '/' || tax_amount::TEXT,
             tax_percent = 18 AND tax_amount = 360
        FROM payments WHERE id = 'ZZTEST-10';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('tax_percent/tax_amount stored correctly', '18/360', v_msg, FALSE);
  END;

  -- tax_amount exceeding the payment amount is nonsensical — rejected.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-11', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2000, 'month', 'Aug 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-08-01',
        'taxPercent', 18, 'taxAmount', 5000
      ), v_token);
    INSERT INTO res VALUES ('tax_amount exceeding payment amount rejected', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO res VALUES ('tax_amount exceeding payment amount rejected', 'REJECT', 'check_violation', TRUE);
  END;

  -- ── 6. quarterly_fee/yearly_fee are PERIOD TOTALS, not per-month rates —
  -- the bug caught during implementation before it shipped. A quarterly
  -- plan of ₹6000 (total) paid as ₹6000 for 3 months must NOT be treated
  -- as "expected ₹18000" (6000 x 3), which would false-positive reject
  -- every real quarterly payment.
  INSERT INTO fee_plans (batch_id, name, training_type, monthly_fee, quarterly_fee, yearly_fee, academy_id)
  SELECT 106, 'ZZ Test Plan', 'daily', 2000, 6000, 22000, academy_id FROM batches WHERE id = 106;

  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-13', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 6000, 'month', 'Oct 2027', 'paymentType', 'quarterly',
        'monthsCovered', 3, 'coverageStart', '2027-10-01'
      ), v_token);
    INSERT INTO res VALUES ('quarterly at plan total (not x3) is NOT a false mismatch', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('quarterly at plan total (not x3) is NOT a false mismatch', 'ALLOW', v_msg, FALSE);
  END;

  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-14', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 22000, 'month', 'Jan 2028', 'paymentType', 'yearly',
        'monthsCovered', 12, 'coverageStart', '2028-01-01'
      ), v_token);
    INSERT INTO res VALUES ('yearly at plan total (not x12) is NOT a false mismatch', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('yearly at plan total (not x12) is NOT a false mismatch', 'ALLOW', v_msg, FALSE);
  END;

  -- Exact fee_plans match now exists (training_type='daily' matches student's
  -- 'Daily' case-insensitively) — a genuinely wild monthly amount must still
  -- be caught, proving the plan lookup (not just the batch default) feeds
  -- the check once a real plan row exists.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-15', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 5, 'month', 'Feb 2028', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2028-02-01'
      ), v_token);
    INSERT INTO res VALUES ('wild amount still caught once a real fee_plans row exists', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    INSERT INTO res VALUES ('wild amount still caught once a real fee_plans row exists', 'amount_mismatch', COALESCE(v_hint,'(null)'), v_hint = 'amount_mismatch');
  END;

  -- ── 7. A custom date-range payment (coverageEnd set) is exempt from the
  -- mismatch check even with a wildly different amount — the server can't
  -- reproduce the client's day-priced proration math.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-16', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 37, 'month', 'Mar 2028', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2028-03-14', 'coverageEnd', '2028-03-31'
      ), v_token);
    INSERT INTO res VALUES ('custom date range (coverageEnd set) exempt from mismatch check', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('custom date range (coverageEnd set) exempt from mismatch check', 'ALLOW', v_msg, FALSE);
  END;

  -- tax_percent over 100 is rejected.
  BEGIN
    PERFORM secure_insert_payment(
      jsonb_build_object(
        'id', 'ZZTEST-12', 'studentId', v_student, 'student', 'ZZ Test',
        'amount', 2000, 'month', 'Sep 2027', 'paymentType', 'monthly',
        'monthsCovered', 1, 'coverageStart', '2027-09-01', 'taxPercent', 150
      ), v_token);
    INSERT INTO res VALUES ('tax_percent over 100 rejected', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO res VALUES ('tax_percent over 100 rejected', 'REJECT', 'check_violation', TRUE);
  END;
END
$do$;

SELECT count(*) FILTER (WHERE NOT pass) AS failures, count(*) AS total FROM res;
SELECT pass, test, expected, got FROM res ORDER BY pass, test;

ROLLBACK;
