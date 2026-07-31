-- ============================================================
-- 0132 — first payment on Add Student: correct date + coverage_start
-- ============================================================
-- WHY
--   db.js sends the COVERAGE start as p_payment_date. A student joining on
--   1 Aug therefore got a payment dated 1 Aug even though the cash was taken
--   on 31 Jul — and the Payments page filters on date.slice(0,7) === current
--   month, so the payment simply vanished from the list. Reported as
--   "payment shows on the student but not in the payments section".
--   Confirmed live: students 2865 (Neha Pandey) and 2859 (Varun Shah) both
--   joined 2026-08-01 with payments dated 2026-08-01, created on 2026-07-31.
--
--   It also mis-states revenue: money collected in July was recognised in
--   August, and the reconciliation check for future-dated payments flagged it.
--
-- WHAT CHANGES (two lines; everything else is the live definition verbatim,
-- fetched via pg_get_functiondef so nothing is transcribed by hand)
--   • date          -> clamped with LEAST(..., ist_today()); a payment can
--                      never be dated in the future.
--   • coverage_start -> now stored, as the first of the join month. It was
--                      NULL before, so removePayment fell back to date when
--                      reverting paidTill — which only worked by accident
--                      because date WAS the coverage start.
--
-- Signature is unchanged (verified: exactly one overload exists), so this
-- cannot trigger the PostgREST "could not choose the best candidate
-- function" failure that migration 0116 had to undo.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_student_with_payment(p_name text, p_parent text, p_phone text, p_parent_phone text, p_age integer, p_dob date, p_sport text, p_batch text, p_batch_id bigint, p_join_date date, p_fees numeric, p_fee_amount numeric, p_fee_due_day integer, p_paid_till date, p_training_type text, p_fee_plan text, p_student_code text, p_join_code text, p_academy_id uuid, p_suspend_now boolean, p_invoice_id text, p_payment_amount numeric, p_payment_month text, p_payment_date date, p_months_covered integer, p_token text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
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
BEGIN
  -- ── Authorization: resolve actor, require students.manage, same-academy ──
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
  IF a.academy_id <> p_academy_id THEN
    RAISE EXCEPTION 'Cross-tenant write blocked' USING ERRCODE = '42501';
  END IF;

  -- ── Branch: field staff are forced into their own branch; others use payload ──
  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  -- ── Branch is mandatory (no all-branch students) ──
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding a student'
      USING ERRCODE = '23502';
  END IF;

  -- ── Status: suspend immediately if overdue at create time ──
  IF p_suspend_now THEN
    v_status := 'Suspended';
    v_suspended_since := public.ist_today();
  ELSE
    v_status := 'Active';
    v_suspended_since := NULL;
  END IF;

  -- ── Step 1: insert student (now with branch_id) ──
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

  -- ── Step 2: bump batch enrolled count (only if active + has batch) ──
  IF p_batch_id IS NOT NULL AND NOT p_suspend_now THEN
    UPDATE batches
       SET enrolled = COALESCE(enrolled, 0) + 1
     WHERE id = p_batch_id;
  END IF;

  -- ── Step 3: insert initial historical payment if provided ──
  IF p_invoice_id IS NOT NULL AND p_payment_amount IS NOT NULL THEN
    INSERT INTO payments (
      id, student_id, student, amount, month, date, coverage_start,
      status, mode, payment_type, discount_pct, months_covered, academy_id
    ) VALUES (
      p_invoice_id,
      v_student_id,
      p_name,
      p_payment_amount,
      COALESCE(p_payment_month, ''),
      -- Money cannot be received on a future date. The client passes the
      -- COVERAGE start here, so a student joining next month produced a
      -- future-dated payment that vanished from the current month's
      -- collections view. Clamp to today; coverage lives in its own column.
      LEAST(COALESCE(p_payment_date, public.ist_today()), public.ist_today()),
      -- Real coverage start: first of the join month (matches
      -- calcHistoricalPayment's startDate), so deleting this payment later
      -- reverts paidTill correctly instead of guessing from the date.
      COALESCE(date_trunc('month', p_join_date)::date, p_payment_date),
      'Paid',
      'Cash',
      'monthly',
      0,
      COALESCE(p_months_covered, 1),
      p_academy_id
    );
  END IF;

  RETURN v_student_id;
END;
$function$
;
