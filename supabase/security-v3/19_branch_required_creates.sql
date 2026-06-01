-- security-v3 / 19 — Branch is MANDATORY on staff/student creation
--
-- Product rule: "there is no all-branch." Every staff and student belongs to
-- exactly one branch. A NULL branch_id is no longer a valid create — it can
-- only ever have happened by accident (owner adding while on the no-branch
-- "all branches of the sport" view), which is the one cross-branch leak path.
--
-- This closes it at the database so even a forged anon-key call cannot create
-- a branchless row:
--   • create_student_with_payment — raise if resolved branch is NULL
--   • secure_insert_staff          — raise if resolved branch is NULL
--   • secure_update_staff_permissions — branch_manager must have a branch
--
-- Owners must therefore be inside a specific branch to add staff/students
-- (a brand-new academy creates its first branch in Settings first). Field
-- staff are still force-bound to their own branch, so they always pass.
--
-- Bodies are copied verbatim from 0073 (student) and 0080 (staff) with only
-- the guard added. Signatures UNCHANGED. IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- create_student_with_payment — require branch
-- ════════════════════════════════════════════════════════════════
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

  -- ── Branch is mandatory (no all-branch students) ──
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding a student'
      USING ERRCODE = '23502';
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

-- ════════════════════════════════════════════════════════════════
-- secure_insert_staff — require branch
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_insert_staff(
  p_token text, p_name text, p_role text, p_phone text DEFAULT ''::text,
  p_sports jsonb DEFAULT '[]'::jsonb, p_salary numeric DEFAULT 0,
  p_join_date date DEFAULT NULL::date, p_status text DEFAULT 'Active'::text,
  p_photo_url text DEFAULT NULL::text, p_staff_code text DEFAULT NULL::text,
  p_join_code text DEFAULT NULL::text, p_staff_type text DEFAULT 'coach'::text,
  p_branch_id uuid DEFAULT NULL::uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- Branch-scoped staff may only create staff inside their own branch.
  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  -- Branch is mandatory (no all-branch staff).
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding staff'
      USING ERRCODE = '23502';
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
    COALESCE(p_join_date, CURRENT_DATE),
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
$function$;
GRANT EXECUTE ON FUNCTION secure_insert_staff(text, text, text, text, jsonb, numeric, date, text, text, text, text, text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_update_staff_permissions — branch_manager must have a branch
-- (verbatim from 0080 + one guard before the UPDATE)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_update_staff_permissions(
  p_staff_id bigint, p_access_role text, p_permissions jsonb, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_staff_branch  UUID;
  v_existing      JSONB;
  v_exceeds       BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT academy_id, branch_id INTO v_staff_academy, v_staff_branch FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy permission edit' USING ERRCODE = '42501';
  END IF;

  -- A branch manager is branch-scoped by definition — they must have a branch,
  -- otherwise the role would silently behave as a full academy-wide admin.
  IF p_access_role = 'branch_manager' AND v_staff_branch IS NULL THEN
    RAISE EXCEPTION 'A branch manager must be assigned to a branch first'
      USING ERRCODE = '23502';
  END IF;

  -- Non-owners: capped, initial-set-only delegation.
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

    -- Must grant at least one permission (prevents an empty grant from falling
    -- back to a broad role preset at login time).
    IF p_permissions IS NULL OR jsonb_array_length(p_permissions) = 0 THEN
      RAISE EXCEPTION 'forbidden: select at least one permission to grant access' USING ERRCODE = '42501';
    END IF;

    -- Escalation guard: every granted permission must be one the caller holds.
    SELECT bool_or(elem NOT IN (
             SELECT jsonb_array_elements_text(COALESCE(a.perms, '[]'::jsonb))
           ))
      INTO v_exceeds
      FROM jsonb_array_elements_text(p_permissions) elem;
    IF COALESCE(v_exceeds, false) THEN
      RAISE EXCEPTION 'forbidden: cannot grant permissions beyond your own' USING ERRCODE = '42501';
    END IF;

    -- Initial-set only: cannot change an existing staff's access.
    SELECT permissions INTO v_existing FROM staff_auth WHERE staff_id = p_staff_id;
    IF v_existing IS NOT NULL AND jsonb_array_length(v_existing) > 0 THEN
      RAISE EXCEPTION 'forbidden: only academy owners can change an existing staff''s access' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE staff_auth SET
    access_role = p_access_role,
    permissions = p_permissions
  WHERE staff_id = p_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_update_staff_permissions(bigint, text, jsonb, text) TO anon, authenticated;

COMMIT;
