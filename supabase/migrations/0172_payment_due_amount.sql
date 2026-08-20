-- ============================================================
-- 0172 — payments.due_amount (partial-payment shortfall column)
-- ============================================================
-- WHAT
--   payments.due_amount — how much of this SPECIFIC payment's locked fee
--   is still outstanding (0 for every normal, fully-paid payment). Set only
--   on the original Paid row when AppContext.addPayment records a partial
--   payment; the linked shortfall row it also creates (status='Pending')
--   is the actual thing that gets collected later via Mark Paid.
--
--   This exists purely so the Payments table can show "₹X due" directly on
--   the original row without parsing the linked Pending row's notes text
--   to find it — a real column, not a string-matching heuristic, for what
--   is ultimately a money figure.
--
--   secure_insert_payment takes a single JSONB payload, so no argument-list
--   change is needed — just reading one more key out of the same payload,
--   defaulting to 0 for every existing caller that doesn't send it.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS due_amount INTEGER NOT NULL DEFAULT 0 CHECK (due_amount >= 0);

CREATE OR REPLACE FUNCTION public.secure_insert_payment(p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_academy_id      UUID;
  v_payment_id      TEXT;
  v_student_id      BIGINT;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_payment_type    TEXT;
  v_amount          NUMERIC;
  v_discount        NUMERIC;
  v_months          INT;
  v_due_amount      NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
    FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);
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

  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start, coverage_end,
    academy_id, notes, due_amount
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
    NULLIF(p_payload->>'coverageStart','')::DATE,
    NULLIF(p_payload->>'coverageEnd','')::DATE,
    v_academy_id,
    p_payload->>'notes',
    v_due_amount
  );

  RETURN v_payment_id;
END;
$function$;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'due_amount';
