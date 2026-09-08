-- ============================================================================
-- Edge-case audit #2 — money precision, date sanity, the mobile /join trial
-- money path, and the Convert-to-Student guards.
--
-- Run:  supabase db query --linked --file scripts/test-payment-trial-mobile-edge.sql
--
-- Everything runs inside a transaction that ROLLS BACK — safe on production.
-- A forged staff session (rolled back too) calls every RPC as a REAL
-- authenticated actor, exactly like the app does.
--
-- Expectations encode the behaviour migration 0197 established. Three of them
-- deliberately assert that something is ALLOWED — those are documented design
-- decisions, not gaps; the comment on each says why.
--
-- Fixture: staff #123 (payments.manage + students.manage), academy
-- cb01cec5-…, branch 047b75b3-…, batch #106 "Football U10 Morning"
-- (₹2000/month via batches.default_fee → _expected_fee_rate), student #2872.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-edge2-token', now() + interval '1 hour');

DO $do$
DECLARE
  v_token   TEXT   := 'zz-edge2-token';
  v_acad    UUID   := 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf';
  v_branch  UUID   := '047b75b3-ded0-4792-8fb2-68c781a0c3e8';
  v_student BIGINT := 2872;
  v_batch   BIGINT := 106;
  v_trial   BIGINT;
  v_trial2  BIGINT;
  v_stu1    BIGINT;
  v_stu2    BIGINT;
  v_n       INT;
  v_num     NUMERIC;
  v_txt     TEXT;
  v_date    DATE;
  v_json    JSON;
BEGIN
  -- ══════════════════════════════════════════════════════════════════
  -- PART A — money precision. payments.amount/due_amount/discount_pct are
  -- INTEGER columns; 0197 rounds explicitly at the RPC boundary instead of
  -- letting an implicit cast do it silently. Whole rupees is the app-wide
  -- invariant (src/lib/tax.js).
  -- ══════════════════════════════════════════════════════════════════

  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZ2A1','studentId',v_student,'student','ZZ','amount',2000.60,'month','Apr 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-04-01',
    'coverageEnd','2027-04-30','status','Paid'
  ), v_token);
  SELECT amount INTO v_num FROM payments WHERE id='ZZ2A1';
  INSERT INTO res VALUES ('A1 amount 2000.60 rounds to whole rupees', '2001', v_num::TEXT, v_num = 2001);

  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZ2A2','studentId',v_student,'student','ZZ','amount',1999.49,'month','May 2027',
    'paymentType','monthly','monthsCovered',1,'coverageStart','2027-05-01',
    'coverageEnd','2027-05-31','status','Paid'
  ), v_token);
  SELECT amount INTO v_num FROM payments WHERE id='ZZ2A2';
  INSERT INTO res VALUES ('A2 amount 1999.49 rounds to whole rupees', '1999', v_num::TEXT, v_num = 1999);

  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZ2A3','studentId',v_student,'student','ZZ','amount',1750,'month','Jun 2027',
    'paymentType','monthly','monthsCovered',1,'discountPct',12.5,'coverageStart','2027-06-01',
    'coverageEnd','2027-06-30','status','Paid'
  ), v_token);
  SELECT discount_pct INTO v_num FROM payments WHERE id='ZZ2A3';
  INSERT INTO res VALUES ('A3 discountPct 12.5 rounds to whole percent', '13', v_num::TEXT, v_num = 13);

  -- A4. Absurd amount — a fat-fingered extra digit on a ₹2,000 fee.
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZ2A4','studentId',v_student,'student','ZZ','amount',20000000,'month','Jul 2027',
      'paymentType','monthly','monthsCovered',1,'confirmedMismatch',true,
      'coverageStart','2027-07-01','coverageEnd','2027-07-31','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('A4 ₹2,00,00,000 payment', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('A4 ₹2,00,00,000 payment', 'REJECT', 'rejected', TRUE);
  END;

  -- ══════════════════════════════════════════════════════════════════
  -- PART B — date and period sanity on secure_insert_payment
  -- ══════════════════════════════════════════════════════════════════

  -- B1. Payment dated years in the future. Clamped to today, the same way
  -- create_student_with_payment already clamps (the UI caps its picker at
  -- today, so nothing legitimate is affected).
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZ2B1','studentId',v_student,'student','ZZ','amount',2000,'month','Jan 2099',
    'paymentType','monthly','monthsCovered',1,'date','2099-01-15',
    'coverageStart','2099-01-01','coverageEnd','2099-01-31','status','Paid'
  ), v_token);
  SELECT date INTO v_date FROM payments WHERE id='ZZ2B1';
  INSERT INTO res VALUES ('B1 payment dated 2099 clamps to today', ist_today()::TEXT, v_date::TEXT, v_date = ist_today());

  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZ2B2','studentId',v_student,'student','ZZ','amount',2000,'month','Aug 2027',
      'paymentType','monthly','monthsCovered',1,
      'coverageStart','2027-08-31','coverageEnd','2027-08-01','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('B2 coverageEnd < coverageStart', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('B2 coverageEnd < coverageStart', 'REJECT', 'rejected', TRUE);
  END;

  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZ2B3','studentId',v_student,'student','ZZ','amount',2000,'month','Sep 2027',
      'paymentType','monthly','monthsCovered',1200,'dueAmount',1,
      'coverageStart','2027-09-01','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('B3 monthsCovered = 1200', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('B3 monthsCovered = 1200', 'REJECT', 'rejected', TRUE);
  END;

  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZ2B4','studentId',v_student,'student','ZZ','amount',100,'month','Oct 2027',
      'paymentType','monthly','monthsCovered',1,'dueAmount',9999999,
      'coverageStart','2027-10-01','status','Paid'
    ), v_token);
    INSERT INTO res VALUES ('B4 ₹99,99,999 due on a ₹100 payment', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('B4 ₹99,99,999 due on a ₹100 payment', 'REJECT', 'rejected', TRUE);
  END;

  -- B5. A real partial payment must still go through untouched.
  PERFORM secure_insert_payment(jsonb_build_object(
    'id','ZZ2B5','studentId',v_student,'student','ZZ','amount',5000,'month','Nov 2027',
    'paymentType','monthly','monthsCovered',1,'dueAmount',8000,
    'coverageStart','2027-11-01','status','Paid'
  ), v_token);
  SELECT due_amount INTO v_num FROM payments WHERE id='ZZ2B5';
  INSERT INTO res VALUES ('B5 genuine ₹8,000 partial still allowed', '8000', v_num::TEXT, v_num = 8000);

  -- B6. …and the shortfall can be cleared once collected (0197 added
  -- dueAmount to secure_update_payment; nothing could zero it before, so a
  -- settled balance showed as still owed forever).
  PERFORM secure_update_payment('ZZ2B5', jsonb_build_object('dueAmount', 0), v_token);
  SELECT due_amount INTO v_num FROM payments WHERE id='ZZ2B5';
  INSERT INTO res VALUES ('B6 settled shortfall can be cleared', '0', v_num::TEXT, v_num = 0);

  -- ══════════════════════════════════════════════════════════════════
  -- PART C — the mobile /join trial money path
  -- ══════════════════════════════════════════════════════════════════

  -- Stand in for secure_submit_public_trial_v2 (it needs an auth.uid() phone
  -- session we cannot forge here) with the exact row shape it writes: the
  -- funnel always sends trialFeeMode='Not collected' and trialFeeAmount=total.
  INSERT INTO trials (name, parent, phone, sport, trial_date, source, status, stage,
                      branch_id, academy_id, batch_id, trial_fee_paid, trial_fee_mode,
                      trial_sessions, sessions_done, converted, program_type)
  VALUES ('ZZ Edge Mobile','ZZ Parent','9990001111','Football', CURRENT_DATE,'App','Scheduled','new',
          v_branch, v_acad, v_batch, 661, 'Not collected', 1, 0, false, 'academy')
  RETURNING id INTO v_trial;

  SELECT count(*) INTO v_n FROM payments WHERE trial_id = v_trial;
  INSERT INTO res VALUES ('C1 fresh /join trial (unpaid) books no payment row', '0', v_n::TEXT, v_n = 0);

  -- C2. What razorpay-verify-trial-payment now does after a captured,
  -- signature-verified payment: one RPC that writes trial + ledger together.
  v_json := secure_book_trial_payment(v_trial, 661, 'Card', 'pay_ZZEDGE2TEST', 'order_ZZEDGE2TEST', 12, 71);

  SELECT count(*) INTO v_n FROM payments WHERE trial_id = v_trial AND payment_type = 'trial' AND status = 'Paid';
  INSERT INTO res VALUES ('C2 online-PAID trial books a payments row', '1', v_n::TEXT, v_n = 1);

  SELECT receipt_no INTO v_txt FROM trials WHERE id = v_trial;
  INSERT INTO res VALUES ('C2b online-PAID trial gets a receipt_no', 'not null', COALESCE(v_txt,'NULL'), v_txt IS NOT NULL);

  -- C2c. The ledger row must self-scope: a trial has no student to join
  -- through, so branch/sport live on the row or it is invisible everywhere.
  SELECT count(*) INTO v_n FROM payments
   WHERE trial_id = v_trial AND branch_id IS NOT NULL AND sport IS NOT NULL;
  INSERT INTO res VALUES ('C2c trial ledger row carries branch + sport', '1', v_n::TEXT, v_n = 1);

  -- C3. Idempotency: the webhook backstop firing after the browser's verify
  -- call (or a Razorpay retry) must not double-book.
  v_json := secure_book_trial_payment(v_trial, 661, 'UPI', 'pay_ZZEDGE2TEST', 'order_ZZEDGE2TEST', 12, 71);
  SELECT count(*) INTO v_n FROM payments WHERE trial_id = v_trial;
  INSERT INTO res VALUES ('C3 second booking (webhook race) does not duplicate', '1', v_n::TEXT,
    v_n = 1 AND (v_json->>'already')::BOOLEAN);

  -- C4. The webhook backstop path: browser died after capture, so the trial
  -- was never verified. razorpay-webhook finds it by the order id that
  -- razorpay-create-trial-order stamped, then books it.
  INSERT INTO trials (name, parent, phone, sport, trial_date, source, status, stage,
                      branch_id, academy_id, batch_id, trial_fee_paid, trial_fee_mode,
                      trial_sessions, sessions_done, converted, program_type, razorpay_order_id)
  VALUES ('ZZ Edge Abandoned','ZZ Parent','9990005555','Football', CURRENT_DATE,'App','Scheduled','new',
          v_branch, v_acad, v_batch, 590, 'Not collected', 1, 0, false, 'academy', 'order_ZZWEBHOOK')
  RETURNING id INTO v_trial2;

  SELECT id INTO v_trial2 FROM trials WHERE razorpay_order_id = 'order_ZZWEBHOOK';
  v_json := secure_book_trial_payment(v_trial2, 590, 'UPI', 'pay_ZZWEBHOOK', 'order_ZZWEBHOOK', NULL, NULL);
  SELECT count(*) INTO v_n FROM payments WHERE trial_id = v_trial2 AND status = 'Paid';
  INSERT INTO res VALUES ('C4 webhook backstop books an abandoned-browser payment', '1', v_n::TEXT, v_n = 1);

  -- C5. Not reachable from a browser session — service_role only.
  SELECT count(*) INTO v_n FROM information_schema.role_routine_grants
   WHERE routine_name = 'secure_book_trial_payment' AND grantee IN ('anon','authenticated','PUBLIC');
  INSERT INTO res VALUES ('C5 book_trial_payment not callable by anon/authenticated', '0', v_n::TEXT, v_n = 0);

  -- ══════════════════════════════════════════════════════════════════
  -- PART D — Convert-to-Student (create_student_with_payment)
  -- ══════════════════════════════════════════════════════════════════

  -- D1. Negative first payment — secure_insert_payment always refused this;
  -- the conversion path did not, and stored -5000.
  BEGIN
    v_stu1 := create_student_with_payment(
      'ZZ Edge Neg','P','9990002222','9990002222', 10, NULL, 'Football','Football U10 Morning',
      v_batch, CURRENT_DATE, 2000, 2000, 5, NULL, 'Daily','monthly','ZZS-NEG','ZZJ-NEG',
      v_acad, false, 'ZZ2D1', -5000, 'Nov 2027', CURRENT_DATE, 1, v_token, v_branch,
      0, 'monthly', NULL, NULL, 'Cash', NULL);
    INSERT INTO res VALUES ('D1 conversion with -₹5000 payment', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('D1 conversion with -₹5000 payment', 'REJECT', 'rejected', TRUE);
  END;

  -- D2. ALLOWED BY DESIGN. A conversion nets the already-booked trial fee and
  -- any joining fee off the first month, so the amount is EXPECTED to sit
  -- below the batch rate — applying secure_insert_payment's 30% fee-plan
  -- check here would reject legitimate conversions (₹2000 rate less a ₹590
  -- trial credit is already 29.5% off). The absurd-value guard in D2b is what
  -- catches a real typo.
  v_stu1 := create_student_with_payment(
    'ZZ Edge Netted','P','9990003333','9990003333', 10, NULL, 'Football','Football U10 Morning',
    v_batch, CURRENT_DATE, 2000, 2000, 5, NULL, 'Daily','monthly','ZZS-MM','ZZJ-MM',
    v_acad, false, 'ZZ2D2', 1410, 'Nov 2027', CURRENT_DATE, 1, v_token, v_branch,
    0, 'monthly', NULL, NULL, 'Cash', NULL);
  INSERT INTO res VALUES ('D2 conversion nets trial credit off month one', 'ALLOW (by design)', 'allowed', TRUE);

  BEGIN
    v_stu2 := create_student_with_payment(
      'ZZ Edge Typo','P','9990003334','9990003334', 10, NULL, 'Football','Football U10 Morning',
      v_batch, CURRENT_DATE, 2000, 2000, 5, NULL, 'Daily','monthly','ZZS-TY','ZZJ-TY',
      v_acad, false, 'ZZ2D2B', 60000000, 'Nov 2027', CURRENT_DATE, 1, v_token, v_branch,
      0, 'monthly', NULL, NULL, 'Cash', NULL);
    INSERT INTO res VALUES ('D2b conversion booking ₹6,00,00,000', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('D2b conversion booking ₹6,00,00,000', 'REJECT', 'rejected', TRUE);
  END;

  -- D3. Two staff converting the same trial. The first wins; the second is
  -- refused server-side rather than minting a second student.
  v_stu1 := create_student_with_payment(
    'ZZ Edge Dup','P','9990004444','9990004444', 10, NULL, 'Football','Football U10 Morning',
    v_batch, CURRENT_DATE, 2000, 2000, 5, NULL, 'Daily','monthly','ZZS-D1','ZZJ-D1',
    v_acad, false, 'ZZ2D3A', 2000, 'Nov 2027', CURRENT_DATE, 1, v_token, v_branch,
    0, 'monthly', NULL, NULL, 'Cash', v_trial);
  PERFORM secure_link_trial_payment(v_trial, v_stu1, v_token);

  BEGIN
    v_stu2 := create_student_with_payment(
      'ZZ Edge Dup','P','9990004444','9990004444', 10, NULL, 'Football','Football U10 Morning',
      v_batch, CURRENT_DATE, 2000, 2000, 5, NULL, 'Daily','monthly','ZZS-D2','ZZJ-D2',
      v_acad, false, 'ZZ2D3B', 2000, 'Nov 2027', CURRENT_DATE, 1, v_token, v_branch,
      0, 'monthly', NULL, NULL, 'Cash', v_trial);
    INSERT INTO res VALUES ('D3 same trial converted twice', 'second REJECTED', 'both accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('D3 same trial converted twice', 'second REJECTED', 'rejected', TRUE);
  END;

  SELECT converted_student_id INTO v_stu2 FROM trials WHERE id = v_trial;
  INSERT INTO res VALUES ('D3b trial back-link survives the second attempt', 'first student',
    'points at '||v_stu2::TEXT, v_stu2 = v_stu1);

  SELECT count(*) INTO v_n FROM payments WHERE id IN ('ZZ2D3A','ZZ2D3B');
  INSERT INTO res VALUES ('D3c no duplicate conversion payment written', '1', v_n::TEXT, v_n = 1);

  -- D4. The trial fee follows the student it converted into, and cannot be
  -- re-pointed at somebody else afterwards.
  SELECT student_id INTO v_stu2 FROM payments WHERE trial_id = v_trial;
  INSERT INTO res VALUES ('D4 trial fee row attaches to the converted student', v_stu1::TEXT,
    COALESCE(v_stu2::TEXT,'NULL'), v_stu2 = v_stu1);

  BEGIN
    PERFORM secure_link_trial_payment(v_trial, v_student, v_token);
    INSERT INTO res VALUES ('D4b relinking the trial to another student', 'REJECT', 'accepted', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('D4b relinking the trial to another student', 'REJECT', 'rejected', TRUE);
  END;

  -- D5. ALLOWED BY DESIGN. A student-linked payment carries no branch_id of
  -- its own — AppContext scopes it through students.branch_id (see
  -- filteredPayments). Only trial rows, which have no student to join
  -- through, self-scope. Asserting the join resolves is the real check.
  SELECT count(*) INTO v_n FROM payments p
    JOIN students s ON s.id = p.student_id
   WHERE p.id = 'ZZ2D3A' AND s.branch_id = v_branch;
  INSERT INTO res VALUES ('D5 conversion payment resolves a branch via its student', '1', v_n::TEXT, v_n = 1);

  -- ══════════════════════════════════════════════════════════════════
  -- PART E — what happens to money when a student is deleted
  -- ══════════════════════════════════════════════════════════════════
  -- DOCUMENTED BEHAVIOUR, not a fix: payments_student_id_fkey is ON DELETE
  -- SET NULL and AppContext.jsx's sportPayments deliberately keeps such
  -- orphans out of sport-scoped views (they are still visible under
  -- "All Sports"). Asserted here so a future change to either has to be
  -- deliberate.
  DELETE FROM students WHERE id = v_stu1;
  SELECT count(*) INTO v_n FROM payments WHERE id = 'ZZ2D3A' AND student_id IS NULL;
  INSERT INTO res VALUES ('E1 deleted student keeps the payment on record', '1', v_n::TEXT, v_n = 1);
END $do$;

SELECT CASE WHEN pass THEN 'PASS' ELSE '*** FAIL' END AS r, test, expected, got
FROM res ORDER BY test;

ROLLBACK;
