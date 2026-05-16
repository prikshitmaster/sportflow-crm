-- ============================================================
-- 0005 — Transactional RPCs for atomic multi-step writes
-- ============================================================
-- Addresses AUDIT.md H5 — "atomic multi-step writes".
--
-- Currently the React app does multi-step writes for some flows
-- (e.g. addStudent does: INSERT students → UPDATE batches.enrolled
-- → INSERT payments). If step N fails, earlier steps stay, leaving
-- the DB in an inconsistent half-state (e.g. a student with no
-- initial payment row, looking "overdue" forever).
--
-- This migration wraps those flows in PL/pgSQL functions that run
-- inside a single implicit transaction. Either ALL writes commit,
-- or NONE do.
--
-- Authorization inside the function: caller's academy_id (from JWT
-- via get_my_academy_id() OR staff session header via
-- current_staff_academy()) MUST match the p_academy_id arg.
-- SECURITY DEFINER bypasses RLS but the explicit check below
-- preserves the tenant boundary.
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║ create_student_with_payment                              ║
-- ║                                                          ║
-- ║ Atomically: INSERT student + (optional) UPDATE           ║
-- ║ batches.enrolled + (optional) INSERT initial payment.    ║
-- ║                                                          ║
-- ║ Returns: the new student's id (BIGINT).                  ║
-- ╚══════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION create_student_with_payment(
  -- ── student fields ──
  p_name            TEXT,
  p_parent          TEXT,
  p_phone           TEXT,
  p_parent_phone    TEXT,
  p_age             INT,
  p_dob             DATE,
  p_sport           TEXT,
  p_batch           TEXT,
  p_batch_id        BIGINT,
  p_join_date       DATE,
  p_fees            NUMERIC,
  p_fee_amount      NUMERIC,
  p_fee_due_day     INT,
  p_paid_till       DATE,
  p_training_type   TEXT,
  p_fee_plan        TEXT,
  p_student_code    TEXT,
  p_join_code       TEXT,
  p_academy_id      UUID,
  -- ── if true, student is created in 'Suspended' state and batch counter is NOT bumped ──
  p_suspend_now     BOOLEAN,
  -- ── optional payment (pass NULL to skip) ──
  p_invoice_id      TEXT,
  p_payment_amount  NUMERIC,
  p_payment_month   TEXT,
  p_payment_date    DATE,
  p_months_covered  INT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_academy UUID;
  v_student_id     BIGINT;
  v_status         TEXT;
  v_suspended_since DATE;
BEGIN
  -- ── Authorization: caller's academy must match the target academy ──
  v_caller_academy := COALESCE(get_my_academy_id(), current_staff_academy());
  IF v_caller_academy IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context';
  END IF;
  IF v_caller_academy <> p_academy_id THEN
    RAISE EXCEPTION 'Cross-tenant write blocked: caller academy % does not match target %',
      v_caller_academy, p_academy_id;
  END IF;

  -- ── Status: suspend immediately if overdue at create time ──
  IF p_suspend_now THEN
    v_status := 'Suspended';
    v_suspended_since := CURRENT_DATE;
  ELSE
    v_status := 'Active';
    v_suspended_since := NULL;
  END IF;

  -- ── Step 1: insert student ──
  INSERT INTO students (
    name, parent, phone, parent_phone,
    age, dob, sport, batch, batch_id,
    join_date, status, suspended_since,
    fees, fee_amount, fee_due_day, paid_till,
    student_code, join_code, account_status,
    training_type, fee_plan, academy_id
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
    p_academy_id
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
$$;

-- ── Allow both authenticated (owner JWT) and anon (staff token) to call ──
GRANT EXECUTE ON FUNCTION create_student_with_payment(
  TEXT, TEXT, TEXT, TEXT, INT, DATE, TEXT, TEXT, BIGINT, DATE,
  NUMERIC, NUMERIC, INT, DATE, TEXT, TEXT, TEXT, TEXT, UUID,
  BOOLEAN, TEXT, NUMERIC, TEXT, DATE, INT
) TO authenticated, anon;


-- ============================================================
-- Verification (run after applying)
-- ============================================================
-- SELECT proname, pronargs
--   FROM pg_proc
--  WHERE proname = 'create_student_with_payment';
--   → should return 1 row, pronargs = 25
--
-- Smoke test (replace ACADEMY_UUID):
-- SELECT create_student_with_payment(
--   'RPC Test Student', 'Test Parent', '9999999999', '',
--   12, NULL, 'Football', '', NULL,
--   CURRENT_DATE, 1000, 1000, NULL, NULL,
--   'Daily', 'monthly', 'SA999', 'TEST01',
--   'ACADEMY_UUID'::uuid, FALSE,
--   NULL, NULL, NULL, NULL, NULL
-- );
-- → returns the new student id; verify with:
-- SELECT id, name, status FROM students WHERE student_code = 'SA999';
-- Cleanup: DELETE FROM students WHERE student_code = 'SA999';


-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS create_student_with_payment(
--   TEXT, TEXT, TEXT, TEXT, INT, DATE, TEXT, TEXT, BIGINT, DATE,
--   NUMERIC, NUMERIC, INT, DATE, TEXT, TEXT, TEXT, TEXT, UUID,
--   BOOLEAN, TEXT, NUMERIC, TEXT, DATE, INT
-- );
