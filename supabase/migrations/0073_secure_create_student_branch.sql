-- 0073 — Harden create_student_with_payment: require students.manage + force branch
--
-- Two gaps closed (the only pre-branch write RPC still unscoped):
--   1. No permission check — any valid staff token could create a student.
--   2. branch_id never set — every student was created branchless (NULL), so a
--      branch manager's new student instantly vanished from their own branch view.
--
-- Now resolves the caller via current_actor(p_token):
--   • owner            → branch_id = p_branch_id (the branch they're viewing, or NULL)
--   • staff w/ branch  → branch_id FORCED to their own branch (cannot create elsewhere)
--   • staff w/o branch → branch_id = p_branch_id (office/multi-branch)
-- and requires the 'students.manage' permission (owners bypass via _require_perm).

BEGIN;

-- Drop the old 25-arg signature (adding params = new overload otherwise)
DROP FUNCTION IF EXISTS create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date,
  numeric, numeric, integer, date, text, text, text, text, uuid, boolean,
  text, numeric, text, date, integer
);

CREATE OR REPLACE FUNCTION create_student_with_payment(
  p_name text, p_parent text, p_phone text, p_parent_phone text, p_age integer,
  p_dob date, p_sport text, p_batch text, p_batch_id bigint, p_join_date date,
  p_fees numeric, p_fee_amount numeric, p_fee_due_day integer, p_paid_till date,
  p_training_type text, p_fee_plan text, p_student_code text, p_join_code text,
  p_academy_id uuid, p_suspend_now boolean, p_invoice_id text, p_payment_amount numeric,
  p_payment_month text, p_payment_date date, p_months_covered integer,
  p_token text DEFAULT NULL, p_branch_id uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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

  -- ── Status: suspend immediately if overdue at create time ──
  IF p_suspend_now THEN
    v_status := 'Suspended';
    v_suspended_since := CURRENT_DATE;
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
    COALESCE(p_join_date, CURRENT_DATE),
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
      id, student_id, student, amount, month, date,
      status, mode, payment_type, discount_pct, months_covered, academy_id
    ) VALUES (
      p_invoice_id,
      v_student_id,
      p_name,
      p_payment_amount,
      COALESCE(p_payment_month, ''),
      COALESCE(p_payment_date, CURRENT_DATE),
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
$function$;

GRANT EXECUTE ON FUNCTION create_student_with_payment(
  text, text, text, text, integer, date, text, text, bigint, date,
  numeric, numeric, integer, date, text, text, text, text, uuid, boolean,
  text, numeric, text, date, integer, text, uuid
) TO anon, authenticated;

COMMIT;
