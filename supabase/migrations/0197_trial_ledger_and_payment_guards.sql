-- 0197 — Audit fixes: the online-trial money path, conversion guards, and the
-- payment sanity checks secure_insert_payment was missing.
--
-- WHAT THIS FIXES (each verified against production before writing):
--
--  1. Trial fees paid online through the /join funnel never reached the
--     payments ledger. secure_insert_trial (staff path) books a payments row;
--     secure_submit_public_trial_v2 (app path) does not, and
--     razorpay-verify-trial-payment only UPDATEd `trials`. Reports reads trial
--     revenue as payments.payment_type='trial', so that money appeared in no
--     revenue figure and the trial got no receipt_no.
--     → new secure_book_trial_payment(), called by both the verify function
--       and the webhook backstop. Idempotent, service-role only.
--
--  2. create_student_with_payment accepted a NEGATIVE payment amount, and had
--     no idea whether the trial it was converting had already been converted —
--     two staff (or one double-tap across two devices, where cross-session
--     sync is a 60s poll) produced two students and two payment rows.
--     → p_trial_id added: locks the trial, refuses an already-converted one,
--       and floors/bounds the payment amount.
--
--  3. secure_link_trial_payment happily re-pointed converted_student_id at a
--     second student, so the last writer won.
--     → refuses to relink a trial that already points at a different student.
--
--  4. secure_insert_payment accepted a payment dated 2099, a coverage_end
--     BEFORE coverage_start, monthsCovered=1200, and a ₹9,999,999 due balance
--     on a ₹100 payment. The date is now clamped the same way
--     create_student_with_payment already clamps it (the UI already sends
--     max=today), and the rest are rejected.
--
--  5. secure_update_payment could not clear due_amount, so a part-payment
--     balance stayed on the record forever after the balance was collected.
--     → accepts dueAmount.
--
--  6. Backfills: clears the one stale due_amount whose balance row is already
--     Paid, and books the missing payments rows for trials that were paid
--     online before fix 1 existed.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- 1. secure_book_trial_payment — the trial-fee ledger entry
-- ════════════════════════════════════════════════════════════════════
-- Called ONLY by the Razorpay edge functions, which hold the service role.
-- There is no p_token/current_actor here on purpose: the caller is a verified
-- gateway callback, not a logged-in actor, and EXECUTE is revoked from anon
-- and authenticated below so no browser session can reach it.
--
-- Idempotent by design. Both the synchronous verify call and the async
-- webhook can fire for the same payment; whichever lands first books it and
-- the other gets `already` back. SELECT ... FOR UPDATE serialises them.

CREATE OR REPLACE FUNCTION public.secure_book_trial_payment(
  p_trial_id           BIGINT,
  p_amount             NUMERIC,
  p_mode               TEXT,
  p_gateway_payment_id TEXT    DEFAULT NULL,
  p_gateway_order_id   TEXT    DEFAULT NULL,
  p_tax_percent        NUMERIC DEFAULT NULL,
  p_tax_amount         NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t         RECORD;
  v_amount  NUMERIC;
  v_mode    TEXT;
  v_pay_id  TEXT;
  v_receipt TEXT;
BEGIN
  SELECT id, academy_id, branch_id, sport, name, trial_date, receipt_no,
         razorpay_payment_id
    INTO t
  FROM trials WHERE id = p_trial_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002';
  END IF;

  -- Already booked by the other caller (verify vs webhook race, or a
  -- Razorpay webhook retry). Report, don't double-book.
  IF t.razorpay_payment_id IS NOT NULL THEN
    RETURN json_build_object(
      'already', true,
      'trialId', t.id,
      'receiptNo', t.receipt_no,
      'paymentId', t.razorpay_payment_id
    );
  END IF;

  -- Whole rupees, same invariant src/lib/tax.js documents for the client.
  v_amount := round(COALESCE(p_amount, 0));
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'trial payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  -- trials.trial_fee_mode has a CHECK limited to these four.
  v_mode := COALESCE(NULLIF(TRIM(p_mode), ''), 'Card');
  IF v_mode NOT IN ('Cash', 'UPI', 'Card') THEN
    v_mode := 'Card';
  END IF;

  UPDATE trials SET
    trial_fee_paid      = v_amount,
    trial_fee_mode      = v_mode,
    razorpay_payment_id = COALESCE(p_gateway_payment_id, razorpay_payment_id),
    razorpay_order_id   = COALESCE(p_gateway_order_id,   razorpay_order_id),
    tax_percent         = CASE WHEN COALESCE(p_tax_amount,0) > 0 THEN p_tax_percent ELSE tax_percent END,
    tax_amount          = CASE WHEN COALESCE(p_tax_amount,0) > 0 THEN p_tax_amount  ELSE tax_amount  END
  WHERE id = p_trial_id;

  -- One payments row per trial, same shape secure_insert_trial writes so both
  -- entry paths land identically in Reports (payment_type='trial') and both
  -- self-scope by branch/sport (a trial has no student to join through).
  SELECT id INTO v_pay_id FROM payments WHERE trial_id = p_trial_id LIMIT 1;

  IF v_pay_id IS NOT NULL THEN
    UPDATE payments SET
      amount             = v_amount,
      mode               = v_mode,
      status             = 'Paid',
      gateway            = CASE WHEN p_gateway_payment_id IS NOT NULL THEN 'razorpay' ELSE gateway END,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_order_id   = COALESCE(p_gateway_order_id,   gateway_order_id),
      tax_percent        = CASE WHEN COALESCE(p_tax_amount,0) > 0 THEN p_tax_percent ELSE tax_percent END,
      tax_amount         = CASE WHEN COALESCE(p_tax_amount,0) > 0 THEN p_tax_amount  ELSE tax_amount  END
    WHERE id = v_pay_id;
    v_receipt := v_pay_id;
  ELSE
    v_receipt := next_trial_receipt_id();
    INSERT INTO payments (
      id, student_id, student, amount, month, date, status, mode,
      payment_type, discount_pct, months_covered, academy_id,
      trial_id, branch_id, sport, notes,
      gateway, gateway_payment_id, gateway_order_id, tax_percent, tax_amount
    ) VALUES (
      v_receipt, NULL, t.name, v_amount,
      to_char(t.trial_date, 'Mon YYYY'), t.trial_date, 'Paid', v_mode,
      'trial', 0, 1, t.academy_id,
      t.id, t.branch_id, t.sport,
      'Trial fee — trial on ' || to_char(t.trial_date, 'DD Mon YYYY'),
      CASE WHEN p_gateway_payment_id IS NOT NULL THEN 'razorpay' ELSE NULL END,
      p_gateway_payment_id, p_gateway_order_id,
      CASE WHEN COALESCE(p_tax_amount,0) > 0 THEN p_tax_percent ELSE NULL END,
      NULLIF(COALESCE(p_tax_amount,0), 0)
    );
  END IF;

  UPDATE trials SET receipt_no = v_receipt WHERE id = p_trial_id;

  RETURN json_build_object(
    'already',   false,
    'trialId',   p_trial_id,
    'receiptNo', v_receipt,
    'amount',    v_amount,
    'mode',      v_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secure_book_trial_payment(BIGINT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.secure_book_trial_payment(BIGINT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.secure_book_trial_payment(BIGINT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.secure_book_trial_payment(BIGINT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. secure_link_trial_payment — one trial converts to one student
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.secure_link_trial_payment(
  p_trial_id BIGINT, p_student_id BIGINT, p_token TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_trial_academy   UUID;
  v_trial_branch    UUID;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_already         BIGINT;
  v_amount          NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden: students cannot perform this action' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind <> 'owner'
     AND NOT (a.perms ? 'trials.manage' OR a.perms ? 'students.manage') THEN
    RAISE EXCEPTION 'forbidden: trials.manage or students.manage required'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id, converted_student_id
    INTO v_trial_academy, v_trial_branch, v_already
  FROM trials WHERE id = p_trial_id;
  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;

  IF v_trial_academy IS NULL OR v_student_academy IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id
     OR v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy link blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch, a.actor_id);
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  -- The trial already became somebody. Silently re-pointing it at a second
  -- student orphaned the first one from its own trial fee and broke every
  -- conversion-rate report — refuse instead. Re-linking the SAME student is
  -- still a no-op success so a retry is safe.
  IF v_already IS NOT NULL AND v_already <> p_student_id THEN
    RAISE EXCEPTION 'This trial was already converted to student #% — refusing to relink', v_already
      USING ERRCODE = '23505', HINT = 'trial_already_converted';
  END IF;

  UPDATE payments
     SET student_id = p_student_id
   WHERE trial_id = p_trial_id
     AND student_id IS NULL;

  UPDATE trials SET converted_student_id = p_student_id WHERE id = p_trial_id;

  SELECT amount INTO v_amount FROM payments WHERE trial_id = p_trial_id LIMIT 1;

  RETURN v_amount;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. create_student_with_payment — trial guard + amount sanity
-- ════════════════════════════════════════════════════════════════════
-- p_trial_id is appended, so the old 32-argument signature must go or a
-- 32-named-argument call becomes ambiguous between the two overloads.

DROP FUNCTION IF EXISTS public.create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date, numeric,
  numeric, integer, date, text, text, text, text, uuid, boolean, text, numeric,
  text, date, integer, text, uuid, numeric, text, date, date, text);

CREATE OR REPLACE FUNCTION public.create_student_with_payment(
  p_name text, p_parent text, p_phone text, p_parent_phone text, p_age integer,
  p_dob date, p_sport text, p_batch text, p_batch_id bigint, p_join_date date,
  p_fees numeric, p_fee_amount numeric, p_fee_due_day integer, p_paid_till date,
  p_training_type text, p_fee_plan text, p_student_code text, p_join_code text,
  p_academy_id uuid, p_suspend_now boolean, p_invoice_id text,
  p_payment_amount numeric, p_payment_month text, p_payment_date date,
  p_months_covered integer, p_token text DEFAULT NULL, p_branch_id uuid DEFAULT NULL,
  p_discount_pct numeric DEFAULT 0, p_payment_type text DEFAULT NULL,
  p_coverage_start date DEFAULT NULL, p_coverage_end date DEFAULT NULL,
  p_mode text DEFAULT 'Cash', p_trial_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_branch_id       UUID;
  v_student_id      BIGINT;
  v_status          TEXT;
  v_suspended_since DATE;
  v_discount_pct    NUMERIC;
  v_payment_type    TEXT;
  v_batch_branch    UUID;
  v_amount          NUMERIC;
  v_months          INT;
  v_trial_academy   UUID;
  v_trial_converted BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
  IF a.academy_id <> p_academy_id THEN
    RAISE EXCEPTION 'Cross-tenant write blocked' USING ERRCODE = '42501';
  END IF;

  -- ── One trial converts exactly once ──────────────────────────────
  -- The client sets trials.converted optimistically to stop a double click,
  -- but two staff on two devices never see each other's flag (cross-session
  -- sync is a 60s poll-on-focus), so the guard has to live here. The advisory
  -- lock closes the window between the check and secure_link_trial_payment.
  IF p_trial_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('trial-convert:' || p_trial_id::text));
    SELECT academy_id, converted_student_id
      INTO v_trial_academy, v_trial_converted
    FROM trials WHERE id = p_trial_id;
    IF v_trial_academy IS NULL THEN
      RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: trial belongs to another academy' USING ERRCODE = '42501';
    END IF;
    IF v_trial_converted IS NOT NULL THEN
      RAISE EXCEPTION 'This trial was already converted to student #% — open that student instead', v_trial_converted
        USING ERRCODE = '23505', HINT = 'trial_already_converted';
    END IF;
  END IF;

  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding a student'
      USING ERRCODE = '23502';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Student name is required' USING ERRCODE = '23514';
  END IF;
  IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
    RAISE EXCEPTION 'Student phone is required' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_fees, 0) < 0 OR COALESCE(p_fee_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Fee amount cannot be negative' USING ERRCODE = '23514';
  END IF;
  IF p_fee_due_day IS NOT NULL AND (p_fee_due_day < 1 OR p_fee_due_day > 31) THEN
    RAISE EXCEPTION 'fee_due_day must be between 1 and 31' USING ERRCODE = '23514';
  END IF;
  IF p_age IS NOT NULL AND (p_age < 0 OR p_age > 120) THEN
    RAISE EXCEPTION 'age must be between 0 and 120' USING ERRCODE = '23514';
  END IF;

  IF p_batch_id IS NOT NULL THEN
    SELECT branch_id INTO v_batch_branch FROM batches WHERE id = p_batch_id;
    IF v_batch_branch IS NULL THEN
      RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_batch_branch IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'forbidden: batch does not belong to this branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_discount_pct := COALESCE(p_discount_pct, 0);
  IF v_discount_pct < 0 OR v_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount percentage must be between 0 and 100' USING ERRCODE = '23514';
  END IF;

  v_payment_type := COALESCE(NULLIF(p_payment_type, ''), NULLIF(p_fee_plan, ''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  -- ── First-payment sanity ─────────────────────────────────────────
  -- No fee-plan mismatch check here on purpose: a conversion legitimately
  -- nets the already-booked trial fee and any joining fee off the first
  -- month, so the amount is EXPECTED to differ from the batch rate.
  -- ₹0 is legitimate too (fully covered by trial credit). Negative is not,
  -- and neither is a fat-fingered extra digit.
  v_amount := p_payment_amount;
  IF v_amount IS NOT NULL THEN
    v_amount := round(v_amount);
    IF v_amount < 0 THEN
      RAISE EXCEPTION 'First payment cannot be negative (got ₹%)', v_amount
        USING ERRCODE = '23514';
    END IF;
    IF v_amount > 5000000 THEN
      RAISE EXCEPTION 'First payment of ₹% looks like a typo — record it from the Payments page if it is real', v_amount
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_months := COALESCE(p_months_covered, 1);
  IF v_months < 1 OR v_months > 120 THEN
    RAISE EXCEPTION 'months covered must be between 1 and 120' USING ERRCODE = '23514';
  END IF;

  IF p_coverage_end IS NOT NULL AND p_coverage_start IS NOT NULL
     AND p_coverage_end < p_coverage_start THEN
    RAISE EXCEPTION 'coverage end cannot be before coverage start' USING ERRCODE = '23514';
  END IF;

  IF p_suspend_now THEN
    v_status := 'Suspended';
    v_suspended_since := public.ist_today();
  ELSE
    v_status := 'Active';
    v_suspended_since := NULL;
  END IF;

  INSERT INTO students (
    name, parent, phone, parent_phone,
    age, dob, sport, batch, batch_id,
    join_date, status, suspended_since,
    fees, fee_amount, fee_due_day, paid_till,
    student_code, join_code, account_status,
    training_type, fee_plan, academy_id, branch_id
  ) VALUES (
    p_name,
    COALESCE(p_parent, ''),
    COALESCE(p_phone, ''),
    COALESCE(p_parent_phone, ''),
    p_age,
    p_dob,
    COALESCE(p_sport, ''),
    COALESCE(p_batch, ''),
    p_batch_id,
    COALESCE(p_join_date, public.ist_today()),
    v_status,
    v_suspended_since,
    COALESCE(p_fees, 0),
    COALESCE(p_fee_amount, COALESCE(p_fees, 0)),
    p_fee_due_day,
    p_paid_till,
    p_student_code,
    p_join_code,
    'pending',
    COALESCE(p_training_type, 'Daily'),
    COALESCE(p_fee_plan, 'monthly'),
    p_academy_id,
    v_branch_id
  )
  RETURNING id INTO v_student_id;

  IF p_batch_id IS NOT NULL AND NOT p_suspend_now THEN
    UPDATE batches
       SET enrolled = COALESCE(enrolled, 0) + 1
     WHERE id = p_batch_id;
  END IF;

  IF p_invoice_id IS NOT NULL AND v_amount IS NOT NULL THEN
    INSERT INTO payments (
      id, student_id, student, amount, month, date, coverage_start, coverage_end,
      status, mode, payment_type, discount_pct, months_covered, academy_id
    ) VALUES (
      p_invoice_id,
      v_student_id,
      p_name,
      v_amount,
      COALESCE(p_payment_month, ''),
      LEAST(COALESCE(p_payment_date, public.ist_today()), public.ist_today()),
      COALESCE(p_coverage_start, date_trunc('month', p_join_date)::date, p_payment_date),
      p_coverage_end,
      'Paid',
      COALESCE(NULLIF(p_mode, ''), 'Cash'),
      v_payment_type,
      v_discount_pct,
      v_months,
      p_academy_id
    );
  END IF;

  RETURN v_student_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4. secure_insert_payment — date and period sanity
-- ════════════════════════════════════════════════════════════════════
-- Only the four new guards below differ from the 0192/0193 body; everything
-- else is carried over byte-for-byte.

CREATE OR REPLACE FUNCTION public.secure_insert_payment(p_payload jsonb, p_token text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                  RECORD;
  v_academy_id       UUID;
  v_payment_id       TEXT;
  v_student_id       BIGINT;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_student_batch    BIGINT;
  v_student_training TEXT;
  v_payment_type     TEXT;
  v_amount           NUMERIC;
  v_discount         NUMERIC;
  v_months           INT;
  v_due_amount       NUMERIC;
  v_late_fee         NUMERIC;
  v_tax_percent      NUMERIC;
  v_tax_amount       NUMERIC;
  v_confirmed        BOOLEAN;
  v_coverage_start   DATE;
  v_coverage_end     DATE;
  v_date             DATE;
  v_expected         NUMERIC;
  v_dup_exists       BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('payment:' || v_student_id::text));

    SELECT academy_id, branch_id, batch_id, training_type
      INTO v_student_academy, v_student_branch, v_student_batch, v_student_training
    FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  -- Whole rupees. payments.amount/due_amount/late_fee/discount_pct are INTEGER
  -- columns; rounding here is explicit rather than an implicit cast, so a
  -- caller that starts sending paise is rounded predictably instead of
  -- silently. (src/lib/tax.js holds the same invariant on the client.)
  v_amount := round(NULLIF(p_payload->>'amount','')::NUMERIC);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF v_amount > 5000000 THEN
    RAISE EXCEPTION 'Amount ₹% looks like a typo — check the digits', v_amount
      USING ERRCODE = '23514';
  END IF;

  v_discount := round(COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0));
  IF v_discount < 0 OR v_discount > 100 THEN
    RAISE EXCEPTION 'discount percentage must be between 0 and 100' USING ERRCODE = '23514';
  END IF;

  v_months := COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1);
  IF v_months < 1 OR v_months > 120 THEN
    RAISE EXCEPTION 'months covered must be between 1 and 120' USING ERRCODE = '23514';
  END IF;

  v_due_amount := round(COALESCE(NULLIF(p_payload->>'dueAmount','')::NUMERIC, 0));
  IF v_due_amount < 0 THEN
    RAISE EXCEPTION 'due amount cannot be negative' USING ERRCODE = '23514';
  END IF;
  -- The due balance is the shortfall against ONE billing period's fee, so
  -- amount + due is that period's total. A ₹9,999,999 balance on a ₹100
  -- payment is a typo that would sit in the Pending column forever.
  IF v_amount + v_due_amount > 5000000 THEN
    RAISE EXCEPTION 'Due balance of ₹% against a ₹% payment looks like a typo', v_due_amount, v_amount
      USING ERRCODE = '23514';
  END IF;

  v_late_fee := round(COALESCE(NULLIF(p_payload->>'lateFee','')::NUMERIC, 0));
  IF v_late_fee < 0 THEN
    RAISE EXCEPTION 'late fee cannot be negative' USING ERRCODE = '23514';
  END IF;

  v_confirmed := COALESCE((p_payload->>'confirmedMismatch')::BOOLEAN, false);

  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  v_coverage_start := NULLIF(p_payload->>'coverageStart','')::DATE;
  v_coverage_end   := NULLIF(p_payload->>'coverageEnd','')::DATE;

  -- A period that ends before it starts prices as negative coverage and
  -- breaks every month-span calculation downstream.
  IF v_coverage_end IS NOT NULL AND v_coverage_start IS NOT NULL
     AND v_coverage_end < v_coverage_start THEN
    RAISE EXCEPTION 'Coverage end (%) cannot be before coverage start (%)', v_coverage_end, v_coverage_start
      USING ERRCODE = '23514';
  END IF;

  -- Same clamp create_student_with_payment already applies. The UI's date
  -- picker is capped at today; a payment dated in the future would otherwise
  -- drop out of every report period until someone noticed.
  v_date := LEAST(COALESCE(NULLIF(p_payload->>'date','')::DATE, public.ist_today()), public.ist_today());

  -- Mismatch enforcement — unchanged from 0192.
  IF v_student_batch IS NOT NULL AND v_coverage_end IS NULL
     AND v_due_amount = 0 AND NOT v_confirmed THEN
    v_expected := _expected_fee_rate(v_student_batch, v_student_training, v_payment_type);
    IF v_payment_type NOT IN ('quarterly', 'yearly') THEN
      v_expected := v_expected * v_months;
    END IF;
    IF v_discount > 0 THEN
      v_expected := v_expected * (1 - v_discount / 100.0);
    END IF;
    IF v_expected > 0 AND abs(v_amount - v_expected) / v_expected > 0.30 THEN
      RAISE EXCEPTION
        'Amount ₹% is far from the expected ₹% for % month(s) at this batch''s rate (after discount). If this is a partial payment, mark it as one; otherwise confirm the amount is correct.',
        v_amount, v_expected, v_months
        USING ERRCODE = '23514', HINT = 'amount_mismatch';
    END IF;
  END IF;

  v_tax_percent := COALESCE(NULLIF(p_payload->>'taxPercent','')::NUMERIC, 0);
  v_tax_amount  := COALESCE(NULLIF(p_payload->>'taxAmount','')::NUMERIC, 0);
  IF v_tax_percent < 0 OR v_tax_percent > 100 THEN
    RAISE EXCEPTION 'tax percent must be between 0 and 100' USING ERRCODE = '23514';
  END IF;
  IF v_tax_amount < 0 OR v_tax_amount > v_amount THEN
    RAISE EXCEPTION 'tax amount cannot be negative or exceed the payment amount' USING ERRCODE = '23514';
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM payments
       WHERE student_id = v_student_id
         AND amount = v_amount
         AND coverage_start IS NOT DISTINCT FROM v_coverage_start
         AND created_at > now() - interval '60 seconds'
    ) INTO v_dup_exists;
    IF v_dup_exists THEN
      RAISE EXCEPTION 'Duplicate payment: an identical payment for this student and period was recorded in the last 60 seconds'
        USING ERRCODE = '23505', HINT = 'duplicate_payment';
    END IF;
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start, coverage_end,
    academy_id, notes, due_amount, late_fee, tax_percent, tax_amount
  ) VALUES (
    v_payment_id,
    v_student_id,
    p_payload->>'student',
    v_amount,
    p_payload->>'month',
    v_date,
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    v_payment_type,
    v_discount,
    v_months,
    v_coverage_start,
    v_coverage_end,
    v_academy_id,
    p_payload->>'notes',
    v_due_amount,
    v_late_fee,
    NULLIF(v_tax_percent, 0),
    NULLIF(v_tax_amount, 0)
  );

  RETURN v_payment_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 5. secure_update_payment — let a settled part-payment balance clear
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.secure_update_payment(
  p_payment_id text, p_payload jsonb, p_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_payment_academy UUID;
  v_student_branch  UUID;
  v_due             NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT p.academy_id, s.branch_id
    INTO v_payment_academy, v_student_branch
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;

  IF v_payment_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: payment belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  IF p_payload ? 'dueAmount' THEN
    v_due := round(COALESCE(NULLIF(p_payload->>'dueAmount','')::NUMERIC, 0));
    IF v_due < 0 THEN
      RAISE EXCEPTION 'due amount cannot be negative' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE payments SET
    status         = CASE WHEN p_payload ? 'status'        THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    mode           = CASE WHEN p_payload ? 'mode'          THEN NULLIF(p_payload->>'mode','')                              ELSE mode           END,
    date           = CASE WHEN p_payload ? 'date'          THEN COALESCE(NULLIF(p_payload->>'date','')::DATE, date)        ELSE date           END,
    month          = CASE WHEN p_payload ? 'month'         THEN COALESCE(NULLIF(p_payload->>'month',''), month)            ELSE month          END,
    amount         = CASE WHEN p_payload ? 'amount'        THEN COALESCE(NULLIF(p_payload->>'amount','')::NUMERIC, amount) ELSE amount         END,
    months_covered = CASE WHEN p_payload ? 'monthsCovered' THEN COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, months_covered) ELSE months_covered END,
    due_amount     = CASE WHEN p_payload ? 'dueAmount'     THEN v_due                                                      ELSE due_amount     END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN p_payload->>'notes'                                        ELSE notes          END
  WHERE id = p_payment_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 6. Backfills
-- ════════════════════════════════════════════════════════════════════

-- 6a. A part-payment whose linked balance row has since been collected still
-- carried its original due_amount, so the student's record showed a red
-- "Amount due" forever. Clear those.
UPDATE payments p
   SET due_amount = 0
 WHERE p.due_amount > 0
   AND EXISTS (
     SELECT 1 FROM payments b
      WHERE b.student_id = p.student_id
        AND b.status = 'Paid'
        AND b.notes LIKE 'Balance due from ' || p.id || '%'
   );

-- 6b. Trials that were paid online BEFORE secure_book_trial_payment existed
-- have the money on the trial row but nothing in the ledger. Book them now,
-- dated to the trial so they land in the right reporting month.
INSERT INTO payments (
  id, student_id, student, amount, month, date, status, mode,
  payment_type, discount_pct, months_covered, academy_id,
  trial_id, branch_id, sport, notes,
  gateway, gateway_payment_id, gateway_order_id, tax_percent, tax_amount
)
SELECT
  next_trial_receipt_id(),
  t.converted_student_id,
  t.name,
  round(t.trial_fee_paid),
  to_char(t.trial_date, 'Mon YYYY'),
  t.trial_date,
  'Paid',
  t.trial_fee_mode,
  'trial', 0, 1, t.academy_id,
  t.id, t.branch_id, t.sport,
  'Trial fee — trial on ' || to_char(t.trial_date, 'DD Mon YYYY') || ' (backfilled 0197)',
  'razorpay', t.razorpay_payment_id, t.razorpay_order_id,
  CASE WHEN COALESCE(t.tax_amount,0) > 0 THEN t.tax_percent ELSE NULL END,
  NULLIF(COALESCE(t.tax_amount,0), 0)
FROM trials t
WHERE t.razorpay_payment_id IS NOT NULL
  AND COALESCE(t.trial_fee_paid, 0) > 0
  AND COALESCE(t.trial_fee_mode, 'Not collected') <> 'Not collected'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id);

UPDATE trials t
   SET receipt_no = p.id
  FROM payments p
 WHERE p.trial_id = t.id
   AND t.receipt_no IS NULL;

COMMIT;
