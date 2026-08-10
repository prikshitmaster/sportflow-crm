-- security-v3 / 26 — Server-side validation guards on the main create RPCs
--
-- Round-3 QA (2026-08-10) live-tested every major "Add" form's RPC with
-- adversarial input and found empty required names, negative fees/salary/
-- capacity, a fee_due_day of 32, age_min > age_max, and negative trial fees
-- all silently accepted. Students.jsx's own client-side validate() already
-- blocks the student-form cases in normal use — this closes the same gaps
-- at the layer that actually matters, so a direct API call or a future UI
-- bug can't create garbage records. Bodies are otherwise byte-identical to
-- the current live definitions (verified via pg_get_functiondef before
-- writing this) — every branch/permission check from prior migrations is
-- preserved exactly; only new validation blocks were inserted.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- create_student_with_payment
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_student_with_payment(
  p_name text, p_parent text, p_phone text, p_parent_phone text, p_age integer,
  p_dob date, p_sport text, p_batch text, p_batch_id bigint, p_join_date date,
  p_fees numeric, p_fee_amount numeric, p_fee_due_day integer, p_paid_till date,
  p_training_type text, p_fee_plan text, p_student_code text, p_join_code text,
  p_academy_id uuid, p_suspend_now boolean, p_invoice_id text, p_payment_amount numeric,
  p_payment_month text, p_payment_date date, p_months_covered integer,
  p_token text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a                 RECORD;
  v_branch_id       UUID;
  v_student_id      BIGINT;
  v_status          TEXT;
  v_suspended_since DATE;
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
      id, student_id, student, amount, month, date, coverage_start,
      status, mode, payment_type, discount_pct, months_covered, academy_id
    ) VALUES (
      p_invoice_id,
      v_student_id,
      p_name,
      p_payment_amount,
      COALESCE(p_payment_month, ''),
      LEAST(COALESCE(p_payment_date, public.ist_today()), public.ist_today()),
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
$$;
GRANT EXECUTE ON FUNCTION public.create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date,
  numeric, numeric, integer, date, text, text, text, text, uuid, boolean,
  text, numeric, text, date, integer, text, uuid
) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_staff
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_staff(
  p_token text, p_name text, p_role text, p_phone text DEFAULT ''::text,
  p_sports jsonb DEFAULT '[]'::jsonb, p_salary numeric DEFAULT 0,
  p_join_date date DEFAULT NULL::date, p_status text DEFAULT 'Active'::text,
  p_photo_url text DEFAULT NULL::text, p_staff_code text DEFAULT NULL::text,
  p_join_code text DEFAULT NULL::text, p_staff_type text DEFAULT 'coach'::text,
  p_branch_id uuid DEFAULT NULL::uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a           RECORD;
  v_staff_id  BIGINT;
  v_branch_id UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding staff'
      USING ERRCODE = '23502';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Staff name is required' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_salary, 0) < 0 THEN
    RAISE EXCEPTION 'Salary cannot be negative' USING ERRCODE = '23514';
  END IF;

  INSERT INTO staff (
    name, role, phone, sports, salary, join_date, status,
    attendance, photo_url, academy_id, branch_id
  )
  VALUES (
    p_name,
    p_role,
    COALESCE(p_phone, ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    COALESCE(p_salary, 0),
    COALESCE(p_join_date, public.ist_today()),
    COALESCE(p_status, 'Active'),
    100,
    NULLIF(p_photo_url, ''),
    a.academy_id,
    v_branch_id
  )
  RETURNING id INTO v_staff_id;

  IF p_staff_code IS NOT NULL AND p_staff_code <> '' THEN
    INSERT INTO staff_auth (staff_id, staff_code, join_code, status, staff_type)
    VALUES (
      v_staff_id,
      upper(p_staff_code),
      upper(p_join_code),
      'pending',
      COALESCE(p_staff_type, 'coach')
    );
  END IF;

  RETURN v_staff_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_staff(text, text, text, text, jsonb, numeric, date, text, text, text, text, text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_batch
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_batch(
  p_token text, p_name text, p_time text DEFAULT NULL::text, p_sports jsonb DEFAULT '[]'::jsonb,
  p_coach text DEFAULT NULL::text, p_capacity integer DEFAULT 30, p_days jsonb DEFAULT '[]'::jsonb,
  p_start_time text DEFAULT NULL::text, p_end_time text DEFAULT NULL::text, p_age_min integer DEFAULT 0,
  p_age_max integer DEFAULT 99, p_ground text DEFAULT NULL::text, p_code text DEFAULT NULL::text,
  p_default_fee integer DEFAULT 0, p_default_plan text DEFAULT 'monthly'::text, p_branch_id uuid DEFAULT NULL::uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a           RECORD;
  v_branch_id UUID;
  v_row       batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before creating a batch'
      USING ERRCODE = '23502';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Batch name is required' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_capacity, 0) <= 0 THEN
    RAISE EXCEPTION 'Capacity must be greater than zero' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_default_fee, 0) < 0 THEN
    RAISE EXCEPTION 'Default fee cannot be negative' USING ERRCODE = '23514';
  END IF;
  IF p_age_min IS NOT NULL AND p_age_max IS NOT NULL AND p_age_min > p_age_max THEN
    RAISE EXCEPTION 'age_min cannot be greater than age_max' USING ERRCODE = '23514';
  END IF;

  INSERT INTO batches (
    name, time, sports, coach, capacity, enrolled, waitlist,
    days, start_time, end_time, age_min, age_max, ground, code,
    default_fee, default_plan, academy_id, branch_id
  ) VALUES (
    p_name,
    p_time,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    p_coach,
    COALESCE(p_capacity, 30),
    0,
    0,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_days, '[]'::JSONB))),
    p_start_time,
    p_end_time,
    COALESCE(p_age_min, 0),
    COALESCE(p_age_max, 99),
    p_ground,
    p_code,
    COALESCE(p_default_fee, 0),
    COALESCE(p_default_plan, 'monthly'),
    a.academy_id,
    v_branch_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_batch(text, text, text, jsonb, text, integer, jsonb, text, text, integer, integer, text, text, integer, text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_fee_plan
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_fee_plan(
  p_batch_id bigint, p_name text, p_training_type text DEFAULT 'daily'::text,
  p_monthly_fee integer DEFAULT 0, p_quarterly_fee integer DEFAULT 0, p_yearly_fee integer DEFAULT 0,
  p_token text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a               RECORD;
  v_row           fee_plans%ROWTYPE;
  v_batch_academy UUID;
  v_batch_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy fee plan create' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Fee plan name is required' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_monthly_fee,0) < 0 OR COALESCE(p_quarterly_fee,0) < 0 OR COALESCE(p_yearly_fee,0) < 0 THEN
    RAISE EXCEPTION 'Fees cannot be negative' USING ERRCODE = '23514';
  END IF;

  INSERT INTO fee_plans (academy_id, batch_id, name, training_type, monthly_fee, quarterly_fee, yearly_fee)
  VALUES (a.academy_id, p_batch_id, p_name, COALESCE(p_training_type,'daily'),
          COALESCE(p_monthly_fee,0), COALESCE(p_quarterly_fee,0), COALESCE(p_yearly_fee,0))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_fee_plan(bigint, text, text, integer, integer, integer, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_trial
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_trial(p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a          RECORD;
  v_id       BIGINT;
  v_branch   UUID;
  v_fee      NUMERIC;
  v_mode     TEXT;
  v_date     DATE;
  v_sport    TEXT;
  v_name     TEXT;
  v_receipt  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  v_branch := NULLIF(p_payload->>'branchId', '')::UUID;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch := a.branch_id;
  END IF;

  v_fee   := COALESCE((p_payload->>'trialFeePaid')::NUMERIC, 590);
  v_mode  := COALESCE(NULLIF(p_payload->>'trialFeeMode', ''), 'Cash');
  v_date  := (p_payload->>'trialDate')::DATE;
  v_sport := p_payload->>'sport';
  v_name  := p_payload->>'name';

  IF v_name IS NULL OR length(trim(v_name)) = 0 THEN
    RAISE EXCEPTION 'Trial name is required' USING ERRCODE = '23514';
  END IF;
  IF p_payload->>'phone' IS NULL OR length(trim(p_payload->>'phone')) = 0 THEN
    RAISE EXCEPTION 'Trial phone is required' USING ERRCODE = '23514';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'Trial fee cannot be negative' USING ERRCODE = '23514';
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, follow_up, notes,
    quoted_fee, session_start, session_end, dob, age_group, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id
  ) VALUES (
    v_name,
    COALESCE(p_payload->>'parent', ''),
    p_payload->>'phone',
    NULLIF(p_payload->>'age', '')::INTEGER,
    v_sport,
    v_date,
    NULLIF(p_payload->>'source', ''),
    'Scheduled',
    'scheduled',
    NULLIF(p_payload->>'batchId', '')::BIGINT,
    COALESCE((p_payload->>'trialSessions')::INTEGER, 1),
    0,
    false,
    NULLIF(p_payload->>'followUp', '')::DATE,
    NULLIF(p_payload->>'notes', ''),
    NULLIF(p_payload->>'quotedFee', '')::NUMERIC,
    NULLIF(p_payload->>'sessionStart', '')::TIME,
    NULLIF(p_payload->>'sessionEnd', '')::TIME,
    NULLIF(p_payload->>'dob', '')::DATE,
    NULLIF(p_payload->>'ageGroup', ''),
    COALESCE(NULLIF(p_payload->>'programType', ''), 'academy'),
    v_fee,
    v_mode,
    a.academy_id,
    v_branch
  )
  RETURNING id INTO v_id;

  IF v_fee > 0 AND v_mode <> 'Not collected' THEN
    v_receipt := next_trial_receipt_id();

    INSERT INTO payments (
      id, student_id, student, amount, month, date, status, mode,
      payment_type, discount_pct, months_covered, academy_id,
      trial_id, branch_id, sport, notes
    ) VALUES (
      v_receipt,
      NULL,
      v_name,
      v_fee,
      to_char(v_date, 'Mon YYYY'),
      v_date,
      'Paid',
      v_mode,
      'trial',
      0,
      1,
      a.academy_id,
      v_id,
      v_branch,
      v_sport,
      'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    );

    UPDATE trials SET receipt_no = v_receipt WHERE id = v_id;
  END IF;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_trial(jsonb, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_payment — extend the round-1 fix with discount/months checks
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_payment(p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    p_payload->>'notes'
  );

  RETURN v_payment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_payment(jsonb, text) TO anon, authenticated;

COMMIT;
