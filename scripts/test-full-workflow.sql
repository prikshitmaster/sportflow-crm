-- Full-workflow adversarial test: permission boundaries, branch isolation,
-- and a real trial -> student -> tricky-payment path, exercising the REAL
-- RPCs (not internal helpers) via forged staff session tokens.
--
-- Run:  supabase db query --linked --file scripts/test-full-workflow.sql
--
-- Everything happens inside a transaction that ROLLS BACK — safe against
-- production, including the temporary permission/branch-setting rewrites.
--
-- Fixture: real staff #123 (academy cb01cec5-..., branch 047b75b3-...) whose
-- permissions get temporarily rewritten per test phase, then restored.
-- Branch isolation is tested against a DIFFERENT real branch in the SAME
-- academy (b32308fc-..., where the batch/ground-capacity fixtures from
-- earlier this session live) — no forging needed, it's a genuinely
-- different tenant boundary already in production data.

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at)
VALUES (123, 'zz-workflow-token', now() + interval '1 hour');

-- Save real permissions so every phase restores exactly what it found.
CREATE TEMP TABLE saved_perms AS SELECT permissions FROM staff_auth WHERE staff_id = 123;

DO $do$
DECLARE
  v_token      TEXT := 'zz-workflow-token';
  v_full_perms JSONB;
  v_trial_id   BIGINT;
  v_new_student BIGINT;
  v_invoice    TEXT;
  v_msg        TEXT;
  v_hint       TEXT;
  v_row        JSONB;
BEGIN
  SELECT permissions INTO v_full_perms FROM saved_perms;

  -- ══════════════════════════════════════════════════════════════════
  -- PART A — permission boundaries (each phase: strip one perm, test
  -- blocked, restore full perms, test allowed)
  -- ══════════════════════════════════════════════════════════════════

  -- A1: no trials.manage -> blocked from creating a trial
  UPDATE staff_auth SET permissions = (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(v_full_perms) p WHERE p <> 'trials.manage') WHERE staff_id = 123;
  BEGIN
    PERFORM secure_insert_trial(jsonb_build_object('name','ZZ Perm Probe','phone','9999900001'), v_token);
    INSERT INTO res VALUES ('staff WITHOUT trials.manage blocked from creating trial', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('staff WITHOUT trials.manage blocked from creating trial', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  -- A2: restore -> trial creation succeeds. This trial carries the whole
  -- workflow through Part C below.
  UPDATE staff_auth SET permissions = v_full_perms WHERE staff_id = 123;
  BEGIN
    v_row := secure_insert_trial(jsonb_build_object(
      'name', 'ZZ Workflow Kid', 'phone', '9999900002', 'parent', 'ZZ Parent',
      'sport', 'Football', 'age', 14, 'trialDate', CURRENT_DATE::TEXT
    ), v_token);
    v_trial_id := (v_row->>'id')::BIGINT;
    INSERT INTO res VALUES ('staff WITH trials.manage creates trial', 'ALLOW', 'allowed', v_trial_id IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('staff WITH trials.manage creates trial', 'ALLOW', v_msg, FALSE);
  END;

  -- A3: no students.manage -> blocked from converting (create_student_with_payment)
  UPDATE staff_auth SET permissions = (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(v_full_perms) p WHERE p <> 'students.manage') WHERE staff_id = 123;
  BEGIN
    PERFORM create_student_with_payment(
      'ZZ Perm Probe', 'ZZ Parent', '9999900001', '9999900099', 14, NULL, 'Football', 'ZZ Combo 1d daily', 106,
      CURRENT_DATE, 2000, 2000, NULL, NULL, 'Daily', 'monthly', 'ZZPROBE1', 'JOINPROBE1',
      'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', false, NULL, NULL, NULL, NULL, NULL,
      v_token, '047b75b3-ded0-4792-8fb2-68c781a0c3e8'
    );
    INSERT INTO res VALUES ('staff WITHOUT students.manage blocked from creating student', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('staff WITHOUT students.manage blocked from creating student', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  -- A4: restore -> convert the REAL trial into a student (this IS the trial
  -- conversion workflow — same RPC Trials.jsx's handleConvert calls via
  -- AppContext addStudent). Uses batch 106 (schedule_type='daily', matches
  -- a Daily-training-type kid — the filter built earlier this session).
  UPDATE staff_auth SET permissions = v_full_perms WHERE staff_id = 123;
  BEGIN
    v_new_student := create_student_with_payment(
      'ZZ Workflow Kid', 'ZZ Parent', '9999900002', '9999900099', 14, NULL, 'Football', 'ZZ Combo 1d daily', 106,
      CURRENT_DATE, 2000, 2000, NULL, NULL, 'Daily', 'monthly', 'ZZWORKFLOW1', 'JOINWORKFLOW1',
      'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', false, NULL, NULL, NULL, NULL, NULL,
      v_token, '047b75b3-ded0-4792-8fb2-68c781a0c3e8'
    );
    UPDATE trials SET converted = true, converted_student_id = v_new_student, stage = 'done' WHERE id = v_trial_id;
    INSERT INTO res VALUES ('staff WITH students.manage converts trial to student', 'ALLOW', 'allowed', v_new_student IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('staff WITH students.manage converts trial to student', 'ALLOW', v_msg, FALSE);
  END;

  -- A5: no payments.manage -> blocked from recording a payment
  UPDATE staff_auth SET permissions = (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(v_full_perms) p WHERE p <> 'payments.manage') WHERE staff_id = 123;
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZWF-PROBE','studentId', v_new_student, 'student','ZZ Workflow Kid',
      'amount', 2000, 'month','Nov 2027', 'paymentType','monthly', 'monthsCovered',1,
      'coverageStart','2027-11-01'
    ), v_token);
    INSERT INTO res VALUES ('staff WITHOUT payments.manage blocked from recording payment', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('staff WITHOUT payments.manage blocked from recording payment', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  -- A6: no batches.manage -> blocked from editing a batch
  UPDATE staff_auth SET permissions = (SELECT jsonb_agg(p) FROM jsonb_array_elements_text(v_full_perms) p WHERE p <> 'batches.manage') WHERE staff_id = 123;
  BEGIN
    PERFORM secure_update_batch(106, jsonb_build_object('capacity', 25), v_token);
    INSERT INTO res VALUES ('staff WITHOUT batches.manage blocked from editing batch', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('staff WITHOUT batches.manage blocked from editing batch', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  UPDATE staff_auth SET permissions = v_full_perms WHERE staff_id = 123;

  -- ══════════════════════════════════════════════════════════════════
  -- PART B — branch isolation (staff #123 is scoped to branch
  -- 047b75b3-...; batches 5/6/157 and student 133 live in the DIFFERENT
  -- branch b32308fc-... of the SAME academy)
  -- ══════════════════════════════════════════════════════════════════

  -- B1: cross-branch batch edit blocked even with full perms.
  BEGIN
    PERFORM secure_update_batch(5, jsonb_build_object('capacity', 99), v_token);
    INSERT INTO res VALUES ('cross-branch batch edit blocked (full perms, wrong branch)', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('cross-branch batch edit blocked (full perms, wrong branch)', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  -- B2: a trial submitted with a smuggled OTHER-branch id is silently
  -- corrected to the actor's OWN branch, not rejected — confirms a
  -- branch-scoped staff can never plant a row in a branch they don't work
  -- in, even by directly setting branchId in the payload.
  BEGIN
    v_row := secure_insert_trial(jsonb_build_object(
      'name', 'ZZ Branch Smuggle Probe', 'phone', '9999900003',
      'sport', 'Football', 'trialDate', CURRENT_DATE::TEXT,
      'branchId', 'b32308fc-3bf7-463f-a456-59a13a67cd17'
    ), v_token);
    INSERT INTO res
      SELECT 'smuggled branchId silently overridden to actor''s own branch',
             '047b75b3-ded0-4792-8fb2-68c781a0c3e8', v_row->>'branch_id',
             v_row->>'branch_id' = '047b75b3-ded0-4792-8fb2-68c781a0c3e8';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('smuggled branchId silently overridden to actor''s own branch', '047b75b3-...', v_msg, FALSE);
  END;

  -- B3: cross-branch payment blocked — student 133 lives in the other branch.
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id','ZZWF-CROSSBRANCH','studentId', 133, 'student','Cross Branch Probe',
      'amount', 500, 'month','Nov 2027', 'paymentType','monthly', 'monthsCovered',1
    ), v_token);
    INSERT INTO res VALUES ('cross-branch payment blocked (student in other branch)', 'REJECT', 'allowed', FALSE);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO res VALUES ('cross-branch payment blocked (student in other branch)', 'REJECT', 'insufficient_privilege', TRUE);
  END;

  -- ══════════════════════════════════════════════════════════════════
  -- PART C — tricky fees on the real workflow student: 10% discount,
  -- ₹50 late fee, 18% tax (temporarily enabled on this branch), AND a
  -- partial payment (parent pays less than the computed total) — all at
  -- once, through the actual hardened secure_insert_payment.
  -- ══════════════════════════════════════════════════════════════════

  UPDATE sport_branches SET tax_on_fees = true, tax_percent = 18
   WHERE id = '047b75b3-ded0-4792-8fb2-68c781a0c3e8';

  -- Full fee ₹2000, 10% discount -> ₹1800, +18% tax -> ₹2124, +₹50 late
  -- fee -> ₹2174 due. Parent actually pays only ₹1000 (partial), so
  -- dueAmount = 2174 - 1000 = 1174.
  v_invoice := 'ZZWF-TRICKY';
  BEGIN
    PERFORM secure_insert_payment(jsonb_build_object(
      'id', v_invoice, 'studentId', v_new_student, 'student', 'ZZ Workflow Kid',
      'amount', 1000, 'month', 'Dec 2027', 'paymentType', 'monthly', 'monthsCovered', 1,
      'coverageStart', '2027-12-01', 'discountPct', 10, 'lateFee', 50,
      'taxPercent', 18, 'taxAmount', 324, 'dueAmount', 1174
    ), v_token);
    INSERT INTO res VALUES ('tricky payment (discount+late fee+tax+partial together) succeeds', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('tricky payment (discount+late fee+tax+partial together) succeeds', 'ALLOW', v_msg, FALSE);
  END;

  INSERT INTO res
    SELECT 'tricky payment stored every field correctly',
           'disc10/late50/tax18/324/due1174',
           discount_pct || '/' || late_fee || '/' || tax_percent || '/' || tax_amount || '/' || due_amount,
           discount_pct = 10 AND late_fee = 50 AND tax_percent = 18 AND tax_amount = 324 AND due_amount = 1174
      FROM payments WHERE id = v_invoice;

  -- The linked "Balance due" row AppContext.addPayment creates client-side
  -- is app-layer, not RPC-layer — not exercised here (this test calls the
  -- RPC directly, same as production would after the client computes the
  -- breakdown). Confirms the RPC's OWN job: store what it's told, validated.

END
$do$;

-- Restore, belt-and-braces (ROLLBACK already does this, but explicit is cheap).
UPDATE staff_auth SET permissions = (SELECT permissions FROM saved_perms) WHERE staff_id = 123;

SELECT count(*) FILTER (WHERE NOT pass) AS failures, count(*) AS total FROM res;
SELECT pass, test, expected, got FROM res ORDER BY pass, test;

ROLLBACK;
