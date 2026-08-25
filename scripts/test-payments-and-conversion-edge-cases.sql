-- Real-world edge-case audit: every payment type through secure_insert_payment,
-- and the Convert-to-Student path through create_student_with_payment.
-- Run:  supabase db query --linked --file scripts/test-payments-and-conversion-edge-cases.sql
--
-- Everything happens inside a transaction that ROLLS BACK — safe against
-- production. Forged staff session (rolled back with everything else) calls
-- every RPC as a REAL authenticated actor, exactly like the app does.
--
-- Fixture: real staff #123 (payments.manage + students.manage, academy
-- cb01cec5-..., branch 047b75b3-...) and real batch #106 "Football U10
-- Morning" (branch default rate ₹2000/month via _expected_fee_rate).

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-edge-test-token', now() + interval '1 hour');

DO $do$
DECLARE
  v_token   TEXT := 'zz-edge-test-token';
  v_student BIGINT := 2872;
  v_batch   BIGINT := 106;
  v_row     RECORD;
  v_id      TEXT;
  v_newstu  BIGINT;
BEGIN
  -- ══════════════════════════════════════════════════════════════════
  -- PART A — secure_insert_payment: real-world payment types
  -- ══════════════════════════════════════════════════════════════════

  -- A1. Plain monthly at expected rate
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA1','studentId',v_student,'student','ZZ','amount',2000,'month','Apr 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-04-01','status','Paid'
  ), v_token);
  INSERT INTO res VALUES ('A1 monthly at expected rate', 'ALLOW', 'allowed', TRUE);

  -- A2. Quarterly flat total (NOT months x rate) — must not be tripled
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA2','studentId',v_student,'student','ZZ','amount',5700,'month','Q2 2027',
    'paymentType','quarterly','monthsCovered',3,'coverageStart','2027-05-01','status','Paid'
  ), v_token);
  INSERT INTO res VALUES ('A2 quarterly flat total (not x3)', 'ALLOW', 'allowed', TRUE);

  -- A3. 20% discount (within 30% tolerance) — no dueAmount/coverageEnd/confirmed needed
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA3','studentId',v_student,'student','ZZ','amount',1600,'month','Aug 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-08-01','status','Paid'
  ), v_token);
  INSERT INTO res VALUES ('A3 20% discount within tolerance, no confirm needed', 'ALLOW', 'allowed', TRUE);

  -- A4. 40% discount (outside 30% tolerance), confirmedMismatch NOT sent,
  -- discountPct SENT (the actual client behavior after the fix) — the
  -- server should now net the discount out of its expected rate before
  -- comparing, matching what the client's own sanityMismatch already does.
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA4','studentId',v_student,'student','ZZ','amount',1200,'month','Sep 2027',
      'paymentType','monthly','monthsCovered',1,'coverageStart','2027-09-01','status','Paid',
      'discountPct',40
    ), v_token);
    INSERT INTO res VALUES ('A4 40pct discount, discountPct sent, server accepts', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A4 40pct discount, discountPct sent, server accepts', 'ALLOW', 'REJECTED: ' || SQLERRM, FALSE);
  END;

  -- A4b. Same discount, but WITHOUT discountPct in the payload (a caller
  -- that doesn't send it, e.g. old client) — must still be rejected exactly
  -- like before, so the fix doesn't accidentally widen the tolerance for
  -- everyone.
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA4B-SHOULD-FAIL','studentId',v_student,'student','ZZ','amount',1200,'month','Sep 2027',
      'paymentType','monthly','monthsCovered',1,'coverageStart','2027-09-02','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('A4b same 40pct-off amount, NO discountPct sent, still rejected', 'REJECT (23514)', 'ALLOWED — fix over-widened tolerance', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A4b same 40pct-off amount, NO discountPct sent, still rejected', 'REJECT (23514)', SQLSTATE, SQLSTATE = '23514');
  END;

  -- A5. Linked due-balance row, no confirmedMismatch — must still be rejected (regression guard)
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA5-SHOULD-FAIL','studentId',v_student,'student','ZZ','amount',800,'month','Oct 2027',
      'paymentType','monthly','monthsCovered',1,'status','Pending'
    ), v_token);
    INSERT INTO res VALUES ('A5 due-balance row w/o confirmedMismatch rejected', 'REJECT', 'ALLOWED — REGRESSION', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A5 due-balance row w/o confirmedMismatch rejected', 'REJECT', SQLSTATE, SQLSTATE = '23514');
  END;

  -- A6. Same, WITH confirmedMismatch — must succeed
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA6','studentId',v_student,'student','ZZ','amount',800,'month','Oct 2027',
    'paymentType','monthly','monthsCovered',1,'status','Pending','confirmedMismatch',true
  ), v_token);
  INSERT INTO res VALUES ('A6 due-balance row WITH confirmedMismatch succeeds', 'ALLOW', 'allowed', TRUE);

  -- A7. Duplicate: same student/amount/coverage_start within 60s — rejected
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA7-DUP','studentId',v_student,'student','ZZ','amount',2000,'month','Apr 2027',
      'paymentType','monthly','monthsCovered',1,'coverageStart','2027-04-01','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('A7 exact duplicate (same period) rejected', 'REJECT (23505)', 'ALLOWED', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A7 exact duplicate (same period) rejected', 'REJECT (23505)', SQLSTATE, SQLSTATE = '23505');
  END;

  -- A8. Catch-up: same amount, DIFFERENT period — must be allowed (not a duplicate)
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA8','studentId',v_student,'student','ZZ','amount',2000,'month','May 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-05-01','status','Paid'
  ), v_token);
  INSERT INTO res VALUES ('A8 same amount, different period, allowed', 'ALLOW', 'allowed', TRUE);

  -- A9. Custom range (coverageEnd set) with an oddball amount — exempted from mismatch
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA9','studentId',v_student,'student','ZZ','amount',333,'month','Nov 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-11-20','coverageEnd','2027-11-30','status','Paid'
  ), v_token);
  INSERT INTO res VALUES ('A9 custom range odd amount exempted', 'ALLOW', 'allowed', TRUE);

  -- A10. Wildly wrong amount, no exemptions — rejected
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA10-SHOULD-FAIL','studentId',v_student,'student','ZZ','amount',50,'month','Dec 2027',
      'paymentType','monthly','monthsCovered',1,'coverageStart','2027-12-01','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('A10 wildly wrong amount rejected', 'REJECT (23514)', 'ALLOWED', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A10 wildly wrong amount rejected', 'REJECT (23514)', SQLSTATE, SQLSTATE = '23514');
  END;

  -- A11. Same, confirmedMismatch=true — allowed
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZA11','studentId',v_student,'student','ZZ','amount',50,'month','Dec 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-12-01','status','Paid','confirmedMismatch',true
  ), v_token);
  INSERT INTO res VALUES ('A11 wildly wrong amount + confirmed, allowed', 'ALLOW', 'allowed', TRUE);

  -- A12. Zero amount — rejected
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZA12-SHOULD-FAIL','studentId',v_student,'student','ZZ','amount',0,'month','Jan 2028',
      'paymentType','monthly','monthsCovered',1,'status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('A12 zero amount rejected', 'REJECT (22023)', 'ALLOWED', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A12 zero amount rejected', 'REJECT (22023)', SQLSTATE, SQLSTATE = '22023');
  END;

  -- ══════════════════════════════════════════════════════════════════
  -- PART B — create_student_with_payment: Convert-to-Student, as it's
  -- actually called today (db.js's exact param set, no more)
  -- ══════════════════════════════════════════════════════════════════

  -- B1. A "custom" conversion (mid-month join, day-priced fee) with a real
  -- 15% discount applied, using the exact param set db.js now sends
  -- (post-fix): discountPct, paymentType, coverageStart, coverageEnd.
  SELECT create_student_with_payment(
    'ZZ Convert Test', 'ZZ Parent', '9999999901', '9999999901', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-01-16',
    1700, 1700, NULL, '2027-01-31', 'Daily', 'custom',
    'ZZSTU1', 'ZZJOIN1', 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'::UUID, false,
    'ZZCONV1', 1445, 'Jan 2027', '2027-01-16', 1,
    v_token, '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID,
    15, 'custom', '2027-01-16', '2027-01-31'
  ) INTO v_newstu;
  INSERT INTO res VALUES ('B1 create_student_with_payment (custom + discount) succeeds', 'ALLOW', 'allowed', TRUE);

  SELECT discount_pct, payment_type, coverage_start, coverage_end, mode, amount
    INTO v_row FROM payments WHERE id = 'ZZCONV1';
  INSERT INTO res VALUES ('B2 discount_pct is stored (was hardcoded 0 before fix)', '15',
    'discount_pct=' || v_row.discount_pct, v_row.discount_pct = 15);
  INSERT INTO res VALUES ('B3 payment_type normalizes custom->monthly (DB constraint), not silently wrong',
    'monthly', 'payment_type=' || v_row.payment_type, v_row.payment_type = 'monthly');
  INSERT INTO res VALUES ('B4 coverage_start is the exact join date (was month-truncated before fix)',
    '2027-01-16', 'coverage_start=' || v_row.coverage_start::TEXT, v_row.coverage_start::TEXT = '2027-01-16');
  INSERT INTO res VALUES ('B5 coverage_end is recorded (was NULL before fix)',
    '2027-01-31', 'coverage_end=' || COALESCE(v_row.coverage_end::TEXT,'NULL'), v_row.coverage_end::TEXT = '2027-01-31');
  INSERT INTO res VALUES ('B6 mode defaults to Cash when not provided (backward compat)',
    'Cash', 'mode=' || v_row.mode, v_row.mode = 'Cash');

  -- B7. Old-style call with NONE of the new params (simulates a caller that
  -- hasn't been updated) — must behave EXACTLY like before the migration:
  -- discount_pct=0, payment_type=monthly, coverage_start=month-truncated.
  SELECT create_student_with_payment(
    'ZZ Convert Old-Style', 'ZZ Parent', '9999999902', '9999999902', NULL, NULL,
    'Football', 'Football U10 Morning', v_batch, '2027-02-16',
    2000, 2000, NULL, '2027-02-28', 'Daily', 'monthly',
    'ZZSTU2', 'ZZJOIN2', 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'::UUID, false,
    'ZZCONV2', 2000, 'Feb 2027', '2027-02-16', 1,
    v_token, '047b75b3-ded0-4792-8fb2-68c781a0c3e8'::UUID
  ) INTO v_newstu;
  SELECT discount_pct, payment_type, coverage_start, coverage_end
    INTO v_row FROM payments WHERE id = 'ZZCONV2';
  INSERT INTO res VALUES ('B7 old-style call (no new params) preserves exact old behavior', '0/monthly/2027-02-01/NULL',
    v_row.discount_pct || '/' || v_row.payment_type || '/' || v_row.coverage_start::TEXT || '/' || COALESCE(v_row.coverage_end::TEXT,'NULL'),
    v_row.discount_pct = 0 AND v_row.payment_type = 'monthly' AND v_row.coverage_start::TEXT = '2027-02-01' AND v_row.coverage_end IS NULL);

END $do$;

DELETE FROM staff_sessions WHERE token = 'zz-edge-test-token';

SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY test;

ROLLBACK;
