-- ============================================================
-- 0129 — payments.coverage_end: support a manual custom coverage
--        date range instead of always snapping to month boundaries
-- ============================================================
-- WHY
--   Every "what does this student owe" calculation (Dashboard, Reports,
--   student/parent portals, this modal's due-months picker) works off a
--   list of whole calendar months, and Payments.jsx always computed the
--   covered period as day-1-of-month → last-day-of-month via
--   `new Date(y, m, 0)`. Reported: "sometime academy charge custom date"
--   — an academy occasionally needs to bill a non-month-aligned period
--   (e.g. a student who joined mid-month) and had no way to record that.
--
--   This is deliberately a MANUAL PER-PAYMENT OVERRIDE, not a per-student
--   recurring billing-cycle-anchor system — that would require rewriting
--   the "owed months" concept everywhere it's read, which is a much
--   bigger, riskier change than what was asked for here.
--
-- WHAT
--   Add payments.coverage_end so a custom-dated payment's exact end date
--   is stored (not just derived from months_covered), so deleting such a
--   payment later can correctly revert the student's paidTill instead of
--   recomputing a wrong month-aligned guess.
--
-- secure_insert_payment body copied verbatim from 0125 (the current
-- authoritative version) with coverage_end added to the INSERT — every
-- existing safety check (cross-academy block, trial-type normalisation)
-- is unchanged.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS coverage_end DATE;

CREATE OR REPLACE FUNCTION secure_insert_payment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_academy_id      UUID;
  v_payment_id      TEXT;
  v_student_id      BIGINT;
  v_student_academy UUID;
  v_payment_type    TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id INTO v_student_academy FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  -- 'custom' is a UI-only concept; 'trial' is reserved for trial-originated
  -- rows. Both normalise to 'monthly' here.
  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start, coverage_end,
    academy_id, notes
  ) VALUES (
    v_payment_id,
    v_student_id,
    p_payload->>'student',
    NULLIF(p_payload->>'amount','')::NUMERIC,
    p_payload->>'month',
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    v_payment_type,
    COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0),
    COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1),
    NULLIF(p_payload->>'coverageStart','')::DATE,
    NULLIF(p_payload->>'coverageEnd','')::DATE,
    v_academy_id,
    p_payload->>'notes'
  );

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_payment(JSONB, TEXT) TO anon, authenticated;
