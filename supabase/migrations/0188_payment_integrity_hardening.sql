-- ============================================================
-- 0188 — Payment integrity hardening (4 verified gaps closed)
-- ============================================================
-- Found by an adversarial audit of the live secure_insert_payment source
-- and the payments table schema (not just the migration files):
--
--   1. Duplicate-payment race — the only guard was a client-side
--      "SELECT, then decide" check with nothing atomic linking it to the
--      later INSERT. Two near-simultaneous submissions could both pass.
--   2. Late fee had no floor anywhere, client or server, and was silently
--      baked into `amount` before it ever reached the server — a negative
--      value quietly under-collected with no due_amount trace.
--   3. The "type CONFIRM for a 30%+ mismatch" gate only disabled a submit
--      button. A direct RPC call had nothing to get past.
--   4. sport_branches.tax_on_fees is a real, saveable setting that
--      Payments.jsx never reads — payments.tax_percent/tax_amount exist
--      but were never populated by this RPC.
--
-- GUIDING CONSTRAINT: partial payments are a legitimate, already-working
-- feature (isPartialPayment -> amountOverride -> due_amount tracks the
-- shortfall). Neither the duplicate guard nor the mismatch check may make
-- a properly-declared partial payment harder — both treat due_amount > 0
-- as a legitimate reason to proceed.
--
-- secure_insert_payment is payload-driven (p_payload JSONB, p_token TEXT)
-- so no signature change / DROP FUNCTION is needed — only its body changes.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. late_fee becomes a real, validated column ──────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS late_fee INTEGER NOT NULL DEFAULT 0 CHECK (late_fee >= 0);

-- ── 2. _expected_fee_rate — server-side mirror of getFeePlanRate ──
-- (Payments.jsx:1592). Same fallback chain: exact trainingType match ->
-- generic (no-type) plan -> sole plan for the batch -> batch default fee
-- (monthly only). Case-insensitive trainingType compare, matching the
-- documented fee_plans (lowercase) vs students (capitalised) mismatch.
CREATE OR REPLACE FUNCTION _expected_fee_rate(
  p_batch_id      BIGINT,
  p_training_type TEXT,
  p_payment_type  TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_want    TEXT := lower(trim(COALESCE(p_training_type, '')));
  v_plan    RECORD;
  v_count   INT;
  v_default NUMERIC;
BEGIN
  IF p_batch_id IS NULL THEN RETURN NULL; END IF;

  -- exact trainingType match
  SELECT * INTO v_plan FROM fee_plans
   WHERE batch_id = p_batch_id AND v_want <> ''
     AND lower(trim(COALESCE(training_type, ''))) = v_want
   LIMIT 1;

  -- generic plan (no training type set) — safe for anyone
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM fee_plans
     WHERE batch_id = p_batch_id AND trim(COALESCE(training_type, '')) = ''
     LIMIT 1;
  END IF;

  -- sole plan for this batch, whatever its type
  IF NOT FOUND THEN
    SELECT count(*) INTO v_count FROM fee_plans WHERE batch_id = p_batch_id;
    IF v_count = 1 THEN
      SELECT * INTO v_plan FROM fee_plans WHERE batch_id = p_batch_id LIMIT 1;
    END IF;
  END IF;

  IF FOUND AND v_plan IS NOT NULL THEN
    RETURN CASE p_payment_type
             WHEN 'quarterly' THEN v_plan.quarterly_fee
             WHEN 'yearly'    THEN v_plan.yearly_fee
             ELSE v_plan.monthly_fee
           END;
  END IF;

  -- batch default fee — monthly only, mirrors the client's own restriction
  IF p_payment_type IS NULL OR p_payment_type = 'monthly' THEN
    SELECT default_fee INTO v_default FROM batches WHERE id = p_batch_id;
    IF v_default > 0 THEN RETURN v_default; END IF;
  END IF;

  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION _expected_fee_rate(BIGINT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. secure_insert_payment — hardened body ──────────────
CREATE OR REPLACE FUNCTION secure_insert_payment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    -- Advisory lock, held for the rest of this transaction: serializes every
    -- concurrent secure_insert_payment call for this SAME student, so the
    -- duplicate check below and this row's insert become effectively atomic.
    -- Without this, two near-simultaneous calls (two tabs, a retried
    -- request) can both pass the check before either has inserted.
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

  -- Late fee: a real, validated field now instead of an invisible
  -- adjustment baked into `amount` by the client. Negative rejected — a
  -- caller who wants to reduce the amount below the expected fee must use
  -- the partial-payment path (due_amount), which is tracked, not this.
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
  -- payment (due_amount already tracks that honestly) or a custom/prorated
  -- date range (client computes its own day-priced expectation for those,
  -- which this server-side approximation can't reproduce; signalled by
  -- coverageEnd being set — see AppContext.jsx addPayment, which only ever
  -- sets it on the customPaidTill path). Anything else that's >30% off the
  -- batch's own fee-plan rate, with no acknowledgement, is exactly the
  -- "unexplained wild amount from a direct API call" this closes — a
  -- legitimate UI-driven typo-confirmation still sails through via
  -- confirmedMismatch.
  --
  -- fee_plans.quarterly_fee / yearly_fee are already PERIOD TOTALS, not
  -- per-month rates (Payments.jsx uses `referenceRate` directly as
  -- baseAmount for those two, never multiplied) — only the monthly rate
  -- scales by months_covered. Getting this backwards would 3x/12x the
  -- expected amount and false-positive-reject every real quarterly/yearly
  -- payment.
  IF v_student_batch IS NOT NULL AND NULLIF(p_payload->>'coverageEnd','')::DATE IS NULL
     AND v_due_amount = 0 AND NOT v_confirmed THEN
    v_expected := _expected_fee_rate(v_student_batch, v_student_training, v_payment_type);
    IF v_payment_type NOT IN ('quarterly', 'yearly') THEN
      v_expected := v_expected * v_months;
    END IF;
    IF v_expected > 0 AND abs(v_amount - v_expected) / v_expected > 0.30 THEN
      RAISE EXCEPTION
        'Amount ₹% is far from the expected ₹% for % month(s) at this batch''s rate. If this is a partial payment, mark it as one; otherwise confirm the amount is correct.',
        v_amount, v_expected, v_months
        USING ERRCODE = '23514', HINT = 'amount_mismatch';
    END IF;
  END IF;

  -- Tax — the client computes the full breakdown (tax.js's computeTax(),
  -- exclusive: tax is added ON TOP of the taxable base, and that total is
  -- already folded into `amount` by the time it gets here) and sends both
  -- numbers along; the RPC stores them as given rather than re-deriving
  -- them from `amount` alone, which would need to un-mix late fee/discount
  -- to get back to the right base. Same trust model the RPC already has
  -- for `amount` itself — this fix is about making the number exist and
  -- display correctly, where before it was silently dropped for every
  -- non-trial payment despite the column already existing.
  v_tax_percent := COALESCE(NULLIF(p_payload->>'taxPercent','')::NUMERIC, 0);
  v_tax_amount  := COALESCE(NULLIF(p_payload->>'taxAmount','')::NUMERIC, 0);
  IF v_tax_percent < 0 OR v_tax_percent > 100 THEN
    RAISE EXCEPTION 'tax percent must be between 0 and 100' USING ERRCODE = '23514';
  END IF;
  IF v_tax_amount < 0 OR v_tax_amount > v_amount THEN
    RAISE EXCEPTION 'tax amount cannot be negative or exceed the payment amount' USING ERRCODE = '23514';
  END IF;

  v_coverage_start := NULLIF(p_payload->>'coverageStart','')::DATE;

  -- Duplicate guard, now atomic thanks to the advisory lock above: the
  -- exact same (student, amount, coverage_start) business rule the client
  -- already implements, just no longer racy.
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
$$;
GRANT EXECUTE ON FUNCTION secure_insert_payment(JSONB, TEXT) TO anon, authenticated;

COMMIT;
