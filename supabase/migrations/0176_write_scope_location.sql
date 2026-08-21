-- 0176 — Phase 4: writes honour location scope too
--
-- 0175 widened READS for a location-scoped staff member. Writes still went
-- through _require_branch_scope(kind, actor_branch, target_branch), which
-- compares a single branch id — so the counter person could SEE a football
-- student at their branch but not take their payment.
--
-- The helper now resolves the caller's full scope from staff.location_id, and
-- every one of the 21 write RPCs passes a.actor_id so it can. Their bodies are
-- read back from pg_get_functiondef and transformed — only the argument list of
-- the _require_branch_scope call changes; no logic is retyped.
--
-- BEHAVIOUR IS UNCHANGED while staff.location_id IS NULL: scope resolves to
-- ARRAY[branch_id], which is exactly the old equality.
--
-- IDEMPOTENT.

BEGIN;

-- The 3-arg signature is dropped so the 4-arg version with a DEFAULT is the
-- only candidate — keeping both would make existing 3-arg calls ambiguous.
DROP FUNCTION IF EXISTS _require_branch_scope(text, uuid, uuid);

CREATE OR REPLACE FUNCTION _require_branch_scope(
  p_actor_kind    TEXT,
  p_actor_branch  UUID,
  p_target_branch UUID,
  p_actor_id      BIGINT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_scope UUID[];
BEGIN
  -- Owners bypass branch scope (they manage the entire academy)
  IF p_actor_kind = 'owner' THEN RETURN; END IF;
  -- Targets without a branch are allowed (unassigned / academy-wide rows)
  IF p_target_branch IS NULL THEN RETURN; END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT CASE
             WHEN s.location_id IS NOT NULL THEN
               COALESCE((SELECT array_agg(sb.id) FROM sport_branches sb
                          WHERE sb.location_id = s.location_id), ARRAY[]::uuid[])
             WHEN s.branch_id IS NOT NULL THEN ARRAY[s.branch_id]
             ELSE NULL
           END
      INTO v_scope
      FROM staff s WHERE s.id = p_actor_id;

    -- NULL scope = office staff, academy-wide
    IF v_scope IS NULL THEN RETURN; END IF;
    IF NOT (p_target_branch = ANY(v_scope)) THEN
      RAISE EXCEPTION 'forbidden: cross-branch action blocked' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  -- Legacy path, byte-for-byte: no actor id supplied.
  IF p_actor_branch IS NULL THEN RETURN; END IF;
  IF p_target_branch IS DISTINCT FROM p_actor_branch THEN
    RAISE EXCEPTION 'forbidden: cross-branch action blocked' USING ERRCODE = '42501';
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION _require_branch_scope(text, uuid, uuid, bigint) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- The 21 write RPCs, re-emitted with a.actor_id threaded through
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.secure_assign_student_to_batch(p_student_id bigint, p_batch_id bigint, p_batch_name text, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_batch_branch    UUID;
  v_training_type   TEXT;
  v_other_batches   INT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id, training_type
    INTO v_student_academy, v_student_branch, v_training_type
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  -- Also block enrolling into a batch from a different branch
  SELECT branch_id INTO v_batch_branch FROM batches WHERE id = p_batch_id;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);

  -- ── Alternate-day students: one batch only ──────────────────────
  -- Counts batches OTHER than the one being assigned, across BOTH sources of
  -- enrolment truth (the primary students.batch_id and the student_batches
  -- rows). Excluding p_batch_id is what keeps a repeat assign to the same
  -- batch a harmless rename instead of an error.
  IF lower(trim(COALESCE(v_training_type, ''))) = 'alternate' THEN
    SELECT count(*) INTO v_other_batches FROM (
      SELECT batch_id FROM student_batches
       WHERE student_id = p_student_id
         AND batch_id IS DISTINCT FROM p_batch_id
      UNION
      SELECT batch_id FROM students
       WHERE id = p_student_id
         AND batch_id IS NOT NULL
         AND batch_id IS DISTINCT FROM p_batch_id
    ) held;

    IF v_other_batches > 0 THEN
      RAISE EXCEPTION
        'Alternate-day students can only be in one batch. Move this student to the new batch instead, or change their training type to Daily first.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
  VALUES (p_student_id, p_batch_id, p_batch_name, a.academy_id)
  ON CONFLICT (student_id, batch_id) DO UPDATE SET
    batch_name = EXCLUDED.batch_name;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_delete_batch(p_batch_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_batch_academy  UUID;
  v_batch_branch   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);

  DELETE FROM batches WHERE id = p_batch_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_delete_fee_plan(p_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a              RECORD;
  v_plan_academy UUID;
  v_plan_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT fp.academy_id, b.branch_id INTO v_plan_academy, v_plan_branch
  FROM fee_plans fp LEFT JOIN batches b ON b.id = fp.batch_id
  WHERE fp.id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_plan_branch, a.actor_id);

  DELETE FROM fee_plans WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_delete_payment(p_payment_id text, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_pay_academy    UUID;
  v_student_branch UUID;
  v_payment_type   TEXT;
  v_trial_id       BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT COALESCE(p.academy_id, s.academy_id), s.branch_id, p.payment_type, p.trial_id
    INTO v_pay_academy, v_student_branch, v_payment_type, v_trial_id
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;
  IF v_pay_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  IF v_payment_type = 'trial' OR v_trial_id IS NOT NULL THEN
    RAISE EXCEPTION 'This is a trial fee receipt — remove the fee from the Trial record instead so both stay in sync'
      USING ERRCODE = '42501';
  END IF;

  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  DELETE FROM payments WHERE id = p_payment_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_delete_staff(p_staff_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_target_academy UUID;
  v_target_branch  UUID;
  v_caller_role    TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_target_academy, v_target_branch
  FROM staff WHERE id = p_staff_id;
  IF v_target_academy IS NULL THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  -- Owner: unrestricted. Branch manager: own branch only. Anyone else: blocked.
  IF a.actor_kind <> 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
    SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
    IF COALESCE(v_caller_role, '') <> 'branch_manager' THEN
      RAISE EXCEPTION 'forbidden: only owners and branch managers can delete staff' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_target_branch, a.actor_id);
  END IF;

  DELETE FROM leave_requests   WHERE staff_id   = p_staff_id;
  DELETE FROM staff_attendance WHERE profile_id = p_staff_id;
  DELETE FROM staff            WHERE id = p_staff_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_delete_student(p_student_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  -- Payments are deliberately NOT deleted. payments_student_id_fkey is
  -- ON DELETE SET NULL, so each row keeps its amount/date/invoice id and the
  -- student's name, and collected revenue stays on the books.
  DELETE FROM student_sessions WHERE student_id = p_student_id;
  DELETE FROM students         WHERE id = p_student_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_insert_fee_plan(p_batch_id bigint, p_name text, p_training_type text DEFAULT 'daily'::text, p_monthly_fee integer DEFAULT 0, p_quarterly_fee integer DEFAULT 0, p_yearly_fee integer DEFAULT 0, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);

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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.secure_link_trial_payment(p_trial_id bigint, p_student_id bigint, p_token text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_trial_academy   UUID;
  v_trial_branch    UUID;
  v_student_academy UUID;
  v_student_branch  UUID;
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

  SELECT academy_id, branch_id INTO v_trial_academy, v_trial_branch     FROM trials   WHERE id = p_trial_id;
  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch FROM students WHERE id = p_student_id;

  IF v_trial_academy IS NULL OR v_student_academy IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id
     OR v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy link blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch, a.actor_id);
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  UPDATE payments
     SET student_id = p_student_id
   WHERE trial_id = p_trial_id
     AND student_id IS NULL;

  -- The actual "which student did this trial become" back-link — powers
  -- the public Profile tab's joining-code/activation display.
  UPDATE trials SET converted_student_id = p_student_id WHERE id = p_trial_id;

  SELECT amount INTO v_amount FROM payments WHERE trial_id = p_trial_id;

  RETURN v_amount;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_reset_student_password(p_student_id bigint, p_join_code text, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  UPDATE students
  SET password_hash  = NULL,
      join_code      = p_join_code,
      account_status = 'pending'
  WHERE id = p_student_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_set_player_focus(p_student_id bigint, p_month text, p_focus_skills jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_row             player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  IF p_focus_skills IS NOT NULL AND jsonb_typeof(p_focus_skills) <> 'array' THEN
    RAISE EXCEPTION 'focus_skills must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy focus' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  UPDATE player_goals
     SET focus_skills    = COALESCE(p_focus_skills, '[]'::jsonb),
         updated_by_role = a.actor_kind
   WHERE student_id = p_student_id
     AND month      = p_month
     AND academy_id = a.academy_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no goal for this student/month — save the goal first'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN row_to_json(v_row);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_unassign_student_from_batch(p_student_id bigint, p_batch_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  DELETE FROM student_batches
  WHERE student_id = p_student_id AND batch_id = p_batch_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_batch(p_batch_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_batch_academy UUID;
  v_batch_branch  UUID;
  v_new_code      TEXT;
  v_row           batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy batch edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);

  -- Branch-scoped staff cannot move a batch to a different branch
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move batch to a different branch' USING ERRCODE = '42501';
  END IF;

  IF p_payload ? 'batchType'
     AND lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development'))
         NOT IN ('development', 'advance')
  THEN
    RAISE EXCEPTION 'batch_type must be development or advance' USING ERRCODE = '23514';
  END IF;

  -- Not required on edit (no backfill), but a non-blank code must stay
  -- unique within the academy, excluding this batch's own current row.
  IF p_payload ? 'code' THEN
    v_new_code := NULLIF(trim(p_payload->>'code'), '');
    IF v_new_code IS NOT NULL AND EXISTS (
      SELECT 1 FROM batches
      WHERE academy_id = v_batch_academy AND lower(code) = lower(v_new_code) AND id <> p_batch_id
    ) THEN
      RAISE EXCEPTION 'Batch code "%" is already used by another batch', v_new_code USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE batches SET
    name         = CASE WHEN p_payload ? 'name'        THEN p_payload->>'name'                            ELSE name         END,
    time         = CASE WHEN p_payload ? 'time'        THEN p_payload->>'time'                            ELSE time         END,
    sports       = CASE WHEN p_payload ? 'sports'      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'sports')) ELSE sports       END,
    coach        = CASE WHEN p_payload ? 'coach'       THEN p_payload->>'coach'                           ELSE coach        END,
    capacity     = CASE WHEN p_payload ? 'capacity'    THEN (p_payload->>'capacity')::INTEGER             ELSE capacity     END,
    days         = CASE WHEN p_payload ? 'days'        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'days'))   ELSE days         END,
    start_time   = CASE WHEN p_payload ? 'startTime'   THEN NULLIF(p_payload->>'startTime', '')           ELSE start_time   END,
    end_time     = CASE WHEN p_payload ? 'endTime'     THEN NULLIF(p_payload->>'endTime', '')             ELSE end_time     END,
    age_min      = CASE WHEN p_payload ? 'ageMin'      THEN COALESCE((p_payload->>'ageMin')::INTEGER, 0) ELSE age_min      END,
    age_max      = CASE WHEN p_payload ? 'ageMax'      THEN COALESCE((p_payload->>'ageMax')::INTEGER, 99) ELSE age_max     END,
    ground       = CASE WHEN p_payload ? 'ground'      THEN NULLIF(p_payload->>'ground', '')              ELSE ground       END,
    code         = CASE WHEN p_payload ? 'code'        THEN v_new_code                                    ELSE code         END,
    default_fee  = CASE WHEN p_payload ? 'defaultFee'  THEN COALESCE((p_payload->>'defaultFee')::INTEGER, 0)  ELSE default_fee  END,
    default_plan = CASE WHEN p_payload ? 'defaultPlan' THEN COALESCE(p_payload->>'defaultPlan', 'monthly')    ELSE default_plan END,
    batch_type   = CASE WHEN p_payload ? 'batchType'   THEN lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development')) ELSE batch_type END,
    branch_id    = CASE WHEN p_payload ? 'branchId'    THEN NULLIF(p_payload->>'branchId','')::UUID            ELSE branch_id    END
  WHERE id = p_batch_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_fee_plan(p_id bigint, p_name text, p_training_type text, p_monthly_fee integer, p_quarterly_fee integer, p_yearly_fee integer, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a              RECORD;
  v_plan_academy UUID;
  v_plan_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT fp.academy_id, b.branch_id INTO v_plan_academy, v_plan_branch
  FROM fee_plans fp LEFT JOIN batches b ON b.id = fp.batch_id
  WHERE fp.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fee plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy fee plan edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_plan_branch, a.actor_id);

  UPDATE fee_plans SET
    name          = p_name,
    training_type = COALESCE(p_training_type, 'daily'),
    monthly_fee   = COALESCE(p_monthly_fee, 0),
    quarterly_fee = COALESCE(p_quarterly_fee, 0),
    yearly_fee    = COALESCE(p_yearly_fee, 0)
  WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_payment(p_payment_id text, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_payment_academy UUID;
  v_student_branch  UUID;
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

  UPDATE payments SET
    status         = CASE WHEN p_payload ? 'status'        THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    mode           = CASE WHEN p_payload ? 'mode'          THEN NULLIF(p_payload->>'mode','')                              ELSE mode           END,
    date           = CASE WHEN p_payload ? 'date'          THEN COALESCE(NULLIF(p_payload->>'date','')::DATE, date)        ELSE date           END,
    month          = CASE WHEN p_payload ? 'month'         THEN COALESCE(NULLIF(p_payload->>'month',''), month)            ELSE month          END,
    amount         = CASE WHEN p_payload ? 'amount'        THEN COALESCE(NULLIF(p_payload->>'amount','')::NUMERIC, amount) ELSE amount         END,
    months_covered = CASE WHEN p_payload ? 'monthsCovered' THEN COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, months_covered) ELSE months_covered END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN p_payload->>'notes'                                        ELSE notes          END
  WHERE id = p_payment_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_staff_permissions(p_staff_id bigint, p_access_role text, p_permissions jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_staff_branch  UUID;
  v_existing      JSONB;
  v_caller_role   TEXT;
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

  IF p_access_role = 'branch_manager' AND v_staff_branch IS NULL THEN
    RAISE EXCEPTION 'A branch manager must be assigned to a branch first'
      USING ERRCODE = '23502';
  END IF;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

    IF p_permissions IS NULL OR jsonb_array_length(p_permissions) = 0 THEN
      RAISE EXCEPTION 'forbidden: select at least one permission to grant access' USING ERRCODE = '42501';
    END IF;

    SELECT bool_or(elem NOT IN (
             SELECT jsonb_array_elements_text(COALESCE(a.perms, '[]'::jsonb))
           ))
      INTO v_exceeds
      FROM jsonb_array_elements_text(p_permissions) elem;
    IF COALESCE(v_exceeds, false) THEN
      RAISE EXCEPTION 'forbidden: cannot grant permissions beyond your own' USING ERRCODE = '42501';
    END IF;

    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);

    SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
    SELECT permissions INTO v_existing     FROM staff_auth WHERE staff_id = p_staff_id;
    IF (v_existing IS NOT NULL AND jsonb_array_length(v_existing) > 0)
       AND COALESCE(v_caller_role, '') <> 'branch_manager' THEN
      RAISE EXCEPTION 'forbidden: only owners and branch managers can change an existing staff''s access' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE staff_auth SET
    access_role = p_access_role,
    permissions = p_permissions
  WHERE staff_id = p_staff_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_staff_profile(p_staff_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_staff_branch  UUID;
  v_caller_role   TEXT;
  v_sports        TEXT[];
  v_caller_sports TEXT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_staff_academy, v_staff_branch
  FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'staff' THEN
    IF a.actor_id IS DISTINCT FROM p_staff_id THEN
      -- Editing someone else: only branch managers, within their own branch.
      SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
      IF COALESCE(v_caller_role, '') <> 'branch_manager' THEN
        RAISE EXCEPTION 'forbidden: staff can only update their own profile' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);
    END IF;
  ELSE
    -- owner: must be same academy
    IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_payload ? 'name' OR p_payload ? 'phone' OR p_payload ? 'photoUrl' THEN
    UPDATE staff SET
      name      = CASE WHEN p_payload ? 'name'     THEN COALESCE(NULLIF(p_payload->>'name',''), name)  ELSE name      END,
      phone     = CASE WHEN p_payload ? 'phone'    THEN COALESCE(p_payload->>'phone', '')               ELSE phone     END,
      photo_url = CASE WHEN p_payload ? 'photoUrl' THEN NULLIF(p_payload->>'photoUrl','')               ELSE photo_url END
    WHERE id = p_staff_id;
  END IF;

  -- ── sports (scope-widening — see SECURITY note in the header) ──────────
  IF p_payload ? 'sports' THEN
    IF a.actor_kind = 'staff' THEN
      -- Re-checked unconditionally: the branch-manager block above is skipped
      -- entirely on the self-edit path, which must NOT be a way to grant
      -- yourself extra sports.
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);
    END IF;

    IF jsonb_typeof(p_payload->'sports') <> 'array' THEN
      RAISE EXCEPTION 'sports must be a JSON array' USING ERRCODE = '22023';
    END IF;

    -- Empty array is meaningful: it stores '{}', which current_staff_sports()
    -- reads as "all sports at this branch".
    v_sports := ARRAY(
      SELECT btrim(x)
      FROM jsonb_array_elements_text(p_payload->'sports') AS t(x)
      WHERE btrim(x) <> ''
    );

    -- No-escalation cap (see header). Only applies to staff callers who are
    -- themselves restricted to a specific set of sports.
    IF a.actor_kind = 'staff' THEN
      SELECT sports INTO v_caller_sports FROM staff WHERE id = a.actor_id;
      IF COALESCE(array_length(v_caller_sports, 1), 0) > 0 THEN
        IF COALESCE(array_length(v_sports, 1), 0) = 0 THEN
          RAISE EXCEPTION 'forbidden: cannot grant all sports beyond your own'
            USING ERRCODE = '42501';
        END IF;
        IF EXISTS (
          SELECT 1 FROM unnest(v_sports) AS want
          WHERE lower(want) NOT IN (SELECT lower(mine) FROM unnest(v_caller_sports) AS mine)
        ) THEN
          RAISE EXCEPTION 'forbidden: cannot grant a sport you do not cover'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    UPDATE staff SET sports = v_sports WHERE id = p_staff_id;
  END IF;

  IF p_payload ? 'age' OR p_payload ? 'licenceUrl' THEN
    INSERT INTO staff_profiles (staff_id, age, licence_url, updated_at)
    VALUES (
      p_staff_id,
      NULLIF(p_payload->>'age','')::INT,
      NULLIF(p_payload->>'licenceUrl',''),
      now()
    )
    ON CONFLICT (staff_id) DO UPDATE SET
      age         = CASE WHEN p_payload ? 'age'        THEN NULLIF(p_payload->>'age','')::INT   ELSE staff_profiles.age         END,
      licence_url = CASE WHEN p_payload ? 'licenceUrl' THEN NULLIF(p_payload->>'licenceUrl','') ELSE staff_profiles.licence_url END,
      updated_at  = now();
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_student(p_student_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  -- Branch-scoped staff cannot move a student to a different branch
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move student to a different branch' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    name            = CASE WHEN p_payload ? 'name'           THEN COALESCE(NULLIF(p_payload->>'name',''), name)             ELSE name           END,
    parent          = CASE WHEN p_payload ? 'parent'         THEN COALESCE(p_payload->>'parent', '')                        ELSE parent         END,
    phone           = CASE WHEN p_payload ? 'phone'          THEN COALESCE(p_payload->>'phone', '')                         ELSE phone          END,
    parent_phone    = CASE WHEN p_payload ? 'parentPhone'    THEN COALESCE(p_payload->>'parentPhone', '')                   ELSE parent_phone   END,
    age             = CASE WHEN p_payload ? 'age'            THEN NULLIF(p_payload->>'age','')::INT                         ELSE age            END,
    dob             = CASE WHEN p_payload ? 'dob'            THEN NULLIF(p_payload->>'dob','')::DATE                        ELSE dob            END,
    sport           = CASE WHEN p_payload ? 'sport'          THEN COALESCE(p_payload->>'sport', '')                         ELSE sport          END,
    batch           = CASE WHEN p_payload ? 'batchName'      THEN COALESCE(p_payload->>'batchName', '')                     ELSE batch          END,
    batch_id        = CASE WHEN p_payload ? 'batchId'        THEN NULLIF(p_payload->>'batchId','')::BIGINT                  ELSE batch_id       END,
    fees            = CASE WHEN p_payload ? 'fees'           THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, 0)       ELSE fees           END,
    fee_amount      = CASE WHEN p_payload ? 'feeAmount'      THEN COALESCE(NULLIF(p_payload->>'feeAmount','')::NUMERIC, fee_amount)
                      WHEN p_payload ? 'fees'                THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, fee_amount)
                      ELSE fee_amount       END,
    paid_till       = CASE WHEN p_payload ? 'paidTill'       THEN NULLIF(p_payload->>'paidTill','')::DATE                   ELSE paid_till      END,
    join_date       = CASE WHEN p_payload ? 'joinDate'       THEN NULLIF(p_payload->>'joinDate','')::DATE                   ELSE join_date      END,
    training_type   = CASE WHEN p_payload ? 'trainingType'   THEN COALESCE(NULLIF(p_payload->>'trainingType',''), 'Daily')  ELSE training_type  END,
    fee_plan        = CASE WHEN p_payload ? 'feePlan'        THEN COALESCE(NULLIF(p_payload->>'feePlan',''), 'monthly')     ELSE fee_plan       END,
    position        = CASE WHEN p_payload ? 'position'       THEN NULLIF(p_payload->>'position','')                         ELSE position       END,
    status          = CASE WHEN p_payload ? 'status'         THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    suspended_since = CASE WHEN p_payload ? 'suspendedSince' THEN NULLIF(p_payload->>'suspendedSince','')::DATE             ELSE suspended_since END,
    photo_url       = CASE WHEN p_payload ? 'photoUrl'       THEN NULLIF(p_payload->>'photoUrl','')                         ELSE photo_url      END,
    height_cm       = CASE WHEN p_payload ? 'heightCm'       THEN NULLIF(p_payload->>'heightCm','')::INT                    ELSE height_cm      END,
    weight_kg       = CASE WHEN p_payload ? 'weightKg'       THEN NULLIF(p_payload->>'weightKg','')::INT                    ELSE weight_kg      END,
    preferred_foot  = CASE WHEN p_payload ? 'preferredFoot'  THEN NULLIF(p_payload->>'preferredFoot','')                    ELSE preferred_foot END,
    wing            = CASE WHEN p_payload ? 'wing'           THEN NULLIF(p_payload->>'wing','')                             ELSE wing           END,
    medical_notes   = CASE WHEN p_payload ? 'medicalNotes'   THEN NULLIF(p_payload->>'medicalNotes','')                     ELSE medical_notes  END,
    relationship    = CASE WHEN p_payload ? 'relationship'   THEN NULLIF(p_payload->>'relationship','')                     ELSE relationship   END,
    gender          = CASE WHEN p_payload ? 'gender'         THEN NULLIF(p_payload->>'gender','')                           ELSE gender         END,
    mother_name     = CASE WHEN p_payload ? 'motherName'     THEN NULLIF(p_payload->>'motherName','')                       ELSE mother_name    END,
    email           = CASE WHEN p_payload ? 'email'          THEN NULLIF(p_payload->>'email','')                            ELSE email          END,
    occupation      = CASE WHEN p_payload ? 'occupation'     THEN NULLIF(p_payload->>'occupation','')                       ELSE occupation     END,
    address         = CASE WHEN p_payload ? 'address'        THEN NULLIF(p_payload->>'address','')                          ELSE address        END,
    alternate_contact_phone = CASE WHEN p_payload ? 'alternateContactPhone' THEN NULLIF(p_payload->>'alternateContactPhone','') ELSE alternate_contact_phone END,
    emergency_contact_name  = CASE WHEN p_payload ? 'emergencyContactName'  THEN NULLIF(p_payload->>'emergencyContactName','')  ELSE emergency_contact_name  END,
    emergency_contact_phone = CASE WHEN p_payload ? 'emergencyContactPhone' THEN NULLIF(p_payload->>'emergencyContactPhone','') ELSE emergency_contact_phone END,
    branch_id       = CASE WHEN p_payload ? 'branchId'       THEN NULLIF(p_payload->>'branchId','')::UUID                   ELSE branch_id      END
  WHERE id = p_student_id;

  RETURN (SELECT row_to_json(s) FROM students s WHERE s.id = p_student_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_update_student_photo(p_student_id bigint, p_photo_url text, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: students can only update their own photo' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);
  END IF;

  UPDATE students SET photo_url = p_photo_url WHERE id = p_student_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_upsert_assessment(p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                  RECORD;
  v_student_id       BIGINT;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_row              skill_assessments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  v_student_id := (p_payload->>'studentId')::BIGINT;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'studentId required' USING ERRCODE = '22023';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = v_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  INSERT INTO skill_assessments (
    student_id, staff_id, batch_id, sport, assessed_month, scores, notes,
    academy_id, category_notes
  ) VALUES (
    v_student_id,
    (p_payload->>'staffId')::BIGINT,
    NULLIF(p_payload->>'batchId','')::BIGINT,
    p_payload->>'sport',
    p_payload->>'month',
    p_payload->'scores',
    NULLIF(p_payload->>'notes',''),
    a.academy_id,
    COALESCE(p_payload->'categoryNotes', '{}'::jsonb)
  )
  ON CONFLICT (student_id, assessed_month, sport) DO UPDATE SET
    staff_id       = EXCLUDED.staff_id,
    batch_id       = EXCLUDED.batch_id,
    scores         = EXCLUDED.scores,
    notes          = EXCLUDED.notes,
    category_notes = EXCLUDED.category_notes
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.secure_upsert_player_goal(p_student_id bigint, p_month text, p_goal_text text, p_staff_id bigint DEFAULT NULL::bigint, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                  RECORD;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_txt              TEXT;
  v_has_focus        BOOLEAN;
  v_row              player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy goal' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  v_txt := trim(COALESCE(p_goal_text, ''));

  IF v_txt = '' THEN
    -- Only destroy the row when there is no focus list attached to it.
    SELECT COALESCE(jsonb_array_length(focus_skills), 0) > 0
      INTO v_has_focus
      FROM player_goals
     WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id;

    IF COALESCE(v_has_focus, FALSE) THEN
      UPDATE player_goals
         SET goal_text       = '',
             staff_id        = p_staff_id,
             updated_by_role = a.actor_kind
       WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id
      RETURNING * INTO v_row;
      RETURN row_to_json(v_row);
    END IF;

    DELETE FROM player_goals
     WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id;
    RETURN NULL;
  END IF;

  INSERT INTO player_goals (student_id, month, goal_text, staff_id, academy_id, updated_by_role)
  VALUES (p_student_id, p_month, v_txt, p_staff_id, a.academy_id, a.actor_kind)
  ON CONFLICT (student_id, month) DO UPDATE SET
    goal_text       = EXCLUDED.goal_text,
    staff_id        = EXCLUDED.staff_id,
    updated_by_role = EXCLUDED.updated_by_role
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$
;

COMMIT;
