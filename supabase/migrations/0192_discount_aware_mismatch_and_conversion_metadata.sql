-- ============================================================
-- 0192 — discount-aware mismatch check + conversion payment metadata
-- ============================================================
-- Found by a real-actor payment/conversion audit (2026-08-26), not code
-- review — every bug below was reproduced against production data through
-- the actual RPCs, not inferred from reading the SQL.
--
-- BUG 1 — secure_insert_payment's mismatch check (0188) compares the final,
-- POST-discount amount against the FULL undiscounted expected rate. A
-- legitimate discount over 30% (a real scenario: sibling discount, hardship
-- case, promo pricing) trips the same ">30% off" rejection as a typo, even
-- though Payments.jsx's own client-side sanityMismatch check already nets
-- the discount out of its expected total and shows no warning — so staff
-- hit a server error the UI never told them was coming. Reproduced: a 40%
-- discount on a ₹2000/month batch (final amount ₹1200) was REJECTED by the
-- server while the client considered it completely normal.
-- FIX: net discountPct out of v_expected before the tolerance comparison,
-- the same adjustment the client already makes.
--
-- BUG 2-4 — create_student_with_payment (the Convert-to-Student RPC) never
-- got the payment-integrity/metadata upgrades secure_insert_payment
-- received in 0188 and since:
--   - discount_pct is hardcoded to 0 in the INSERT — a discount applied
--     during conversion reduces the amount charged (computed client-side)
--     but the stored record shows "0% off", so every receipt/report/audit
--     downstream reads it as full price. Reproduced: discount_pct=0 stored
--     regardless of what was actually discounted.
--   - payment_type is hardcoded to 'monthly' regardless of the plan
--     actually picked (quarterly/yearly/custom) — corrupts any reporting
--     that keys off payment_type. Reproduced: payment_type=monthly stored
--     for a plan explicitly converted as 'custom'.
--   - coverage_start is always date_trunc('month', join_date) — a custom
--     mid-month join's exact start date is silently rounded down to the
--     1st, losing the real coverage boundary. Reproduced: joined 2027-01-16,
--     stored coverage_start=2027-01-01.
--   - coverage_end is never stored at all (column omitted from the INSERT),
--     so nothing downstream (ageing, the Payments Custom-range exemption,
--     markPaymentPaid's coverage-advance guard) can tell this was a priced
--     range rather than an open-ended monthly payment.
-- FIX: four new optional parameters (p_discount_pct, p_payment_type,
-- p_coverage_start, p_coverage_end), each defaulting to the OLD hardcoded
-- behavior so any caller that doesn't pass them is unaffected. Same
-- 'custom'/'trial' -> 'monthly' normalization secure_insert_payment already
-- does, since payments.payment_type's CHECK constraint only allows
-- monthly/quarterly/yearly.
--
-- Positional-arg RPC (not JSONB payload) — DROP required before CREATE OR
-- REPLACE per the established pattern (0171/0187-0191): CREATE OR REPLACE
-- only replaces a function with the EXACT same argument list.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── Fix 1: discount-aware mismatch check (same signature, no DROP needed) ──

CREATE OR REPLACE FUNCTION public.secure_insert_payment(p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_amount := NULLIF(p_payload->>'amount','')::NUMERIC;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  v_discount := COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0);
  IF v_discount < 0 OR v_discount > 100 THEN
    RAISE EXCEPTION 'discount percentage must be between 0 and 100' USING ERRCODE = '23514';
  END IF;
  v_months := COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1);
  IF v_months < 1 THEN
    RAISE EXCEPTION 'months covered must be at least 1' USING ERRCODE = '23514';
  END IF;

  v_due_amount := COALESCE(NULLIF(p_payload->>'dueAmount','')::NUMERIC, 0);
  IF v_due_amount < 0 THEN
    RAISE EXCEPTION 'due amount cannot be negative' USING ERRCODE = '23514';
  END IF;

  v_late_fee := COALESCE(NULLIF(p_payload->>'lateFee','')::NUMERIC, 0);
  IF v_late_fee < 0 THEN
    RAISE EXCEPTION 'late fee cannot be negative' USING ERRCODE = '23514';
  END IF;

  v_confirmed := COALESCE((p_payload->>'confirmedMismatch')::BOOLEAN, false);

  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  -- Mismatch enforcement — scoped to never block a legitimate partial
  -- payment (due_amount already tracks that honestly), a custom/prorated
  -- date range (coverageEnd set), or an explicitly acknowledged amount
  -- (confirmedMismatch). Discount is netted out of the expected rate
  -- before comparing — a legitimate discount already brings the amount
  -- below the batch rate on purpose, same adjustment the client's own
  -- sanityMismatch check makes, so this can't reject what the UI already
  -- decided was fine.
  IF v_student_batch IS NOT NULL AND NULLIF(p_payload->>'coverageEnd','')::DATE IS NULL
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

  v_coverage_start := NULLIF(p_payload->>'coverageStart','')::DATE;

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
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    v_payment_type,
    v_discount,
    v_months,
    v_coverage_start,
    NULLIF(p_payload->>'coverageEnd','')::DATE,
    v_academy_id,
    p_payload->>'notes',
    v_due_amount,
    v_late_fee,
    NULLIF(v_tax_percent, 0),
    NULLIF(v_tax_amount, 0)
  );

  RETURN v_payment_id;
END;
$function$;

-- ── Fix 2: create_student_with_payment metadata gaps ──

DROP FUNCTION IF EXISTS create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date, numeric, numeric,
  integer, date, text, text, text, text, uuid, boolean, text, numeric, text, date,
  integer, text, uuid
);

CREATE OR REPLACE FUNCTION public.create_student_with_payment(
  p_name text, p_parent text, p_phone text, p_parent_phone text, p_age integer, p_dob date,
  p_sport text, p_batch text, p_batch_id bigint, p_join_date date, p_fees numeric,
  p_fee_amount numeric, p_fee_due_day integer, p_paid_till date, p_training_type text,
  p_fee_plan text, p_student_code text, p_join_code text, p_academy_id uuid,
  p_suspend_now boolean, p_invoice_id text, p_payment_amount numeric, p_payment_month text,
  p_payment_date date, p_months_covered integer, p_token text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_discount_pct   NUMERIC DEFAULT 0,
  p_payment_type   TEXT    DEFAULT NULL,
  p_coverage_start DATE    DEFAULT NULL,
  p_coverage_end   DATE    DEFAULT NULL,
  p_mode           TEXT    DEFAULT 'Cash'
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_branch_id       UUID;
  v_student_id      BIGINT;
  v_status          TEXT;
  v_suspended_since DATE;
  v_discount_pct    NUMERIC;
  v_payment_type    TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
  IF a.academy_id <> p_academy_id THEN
    RAISE EXCEPTION 'Cross-tenant write blocked' USING ERRCODE = '42501';
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

  v_discount_pct := COALESCE(p_discount_pct, 0);
  IF v_discount_pct < 0 OR v_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount percentage must be between 0 and 100' USING ERRCODE = '23514';
  END IF;

  -- Same normalization secure_insert_payment applies — payments.payment_type's
  -- CHECK constraint only allows monthly/quarterly/yearly; 'custom' (Convert-
  -- to-Student's day-priced range) and 'trial' are UI-only concepts.
  -- Defaults to p_fee_plan for backward compat with callers that don't pass
  -- p_payment_type at all (kept 'monthly' as the ultimate fallback, matching
  -- the old hardcoded behavior exactly).
  v_payment_type := COALESCE(NULLIF(p_payment_type, ''), NULLIF(p_fee_plan, ''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
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

  IF p_invoice_id IS NOT NULL AND p_payment_amount IS NOT NULL THEN
    INSERT INTO payments (
      id, student_id, student, amount, month, date, coverage_start, coverage_end,
      status, mode, payment_type, discount_pct, months_covered, academy_id
    ) VALUES (
      p_invoice_id,
      v_student_id,
      p_name,
      p_payment_amount,
      COALESCE(p_payment_month, ''),
      LEAST(COALESCE(p_payment_date, public.ist_today()), public.ist_today()),
      -- Exact coverage start when the caller provides one (a custom mid-
      -- month join keeps its real start day); falls back to the OLD
      -- month-truncated behavior otherwise so existing callers are unaffected.
      COALESCE(p_coverage_start, date_trunc('month', p_join_date)::date, p_payment_date),
      p_coverage_end,
      'Paid',
      COALESCE(NULLIF(p_mode, ''), 'Cash'),
      v_payment_type,
      v_discount_pct,
      COALESCE(p_months_covered, 1),
      p_academy_id
    );
  END IF;

  RETURN v_student_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date, numeric, numeric,
  integer, date, text, text, text, text, uuid, boolean, text, numeric, text, date,
  integer, text, uuid, numeric, text, date, date, text
) TO anon, authenticated;

COMMIT;
