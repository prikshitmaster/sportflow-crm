-- ============================================================
-- 0193 — batch_id must belong to the student's own branch
-- ============================================================
-- Found by an adversarial branch/sport-isolation audit (2026-08-27), not
-- code review — reproduced against production data as a real staff actor,
-- not inferred.
--
-- BUG: neither create_student_with_payment nor secure_update_student ever
-- verified that a batch_id being assigned to a student actually belongs to
-- that student's own branch. A staff member scoped to one branch could:
--   1. Create a student correctly locked to their own branch, but attach
--      them to a batch from a COMPLETELY DIFFERENT branch (different sport,
--      even) — reproduced: a Football-branch staff created a student with
--      branch_id=Football but batch_id pointing at a Squash batch in a
--      different branch, no error.
--   2. Reassign an EXISTING student (via secure_update_student, the same
--      path reassignStudentBatch/removeStudentFromBatch/updateStudent all
--      go through) onto a batch from another branch — also silently
--      allowed. The student's own `sport` field is left stale/inconsistent
--      with the batch they're now actually in.
--   3. In doing so, create_student_with_payment's batches.enrolled
--      increment ran against that FOREIGN batch with no branch check at
--      all — a staff member with zero access to Branch B could inflate
--      Branch B's own batch capacity/enrolled numbers just by referencing
--      its batch id from Branch A's side. Reproduced: enrolled went from 0
--      to 1 on a batch belonging to a branch the actor had no scope over.
--
-- FIX: both RPCs now verify the batch's branch_id matches the branch the
-- student belongs (or is being created) to, and reject with 42501
-- otherwise. Same signatures — CREATE OR REPLACE only, no DROP needed,
-- since no parameters are added or removed.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

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
  v_target_branch   UUID;
  v_new_batch_id    BIGINT;
  v_batch_branch    UUID;
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

  -- A batch belongs to exactly one branch — a batch_id assignment (whether
  -- from the Edit form, reassignStudentBatch, or removeStudentFromBatch's
  -- clear-to-null) must target a batch in the SAME branch the student
  -- belongs to (or is moving to, if branchId is also changing in this same
  -- call — owner-only per the check above). Migration 0193.
  IF p_payload ? 'batchId' THEN
    v_new_batch_id := NULLIF(p_payload->>'batchId','')::BIGINT;
    IF v_new_batch_id IS NOT NULL THEN
      v_target_branch := COALESCE(NULLIF(p_payload->>'branchId','')::UUID, v_student_branch);
      SELECT branch_id INTO v_batch_branch FROM batches WHERE id = v_new_batch_id;
      IF v_batch_branch IS NULL THEN
        RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
      END IF;
      IF v_batch_branch IS DISTINCT FROM v_target_branch THEN
        RAISE EXCEPTION 'forbidden: batch does not belong to this student''s branch' USING ERRCODE = '42501';
      END IF;
    END IF;
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
    last_batch_name = CASE WHEN p_payload ? 'lastBatchName'  THEN NULLIF(p_payload->>'lastBatchName','')                    ELSE last_batch_name END,
    last_batch_id   = CASE WHEN p_payload ? 'lastBatchId'    THEN NULLIF(p_payload->>'lastBatchId','')::BIGINT              ELSE last_batch_id  END,
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
$function$;

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
  v_batch_branch    UUID;
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

  -- A batch belongs to exactly one branch — reject rather than silently
  -- attach a student (and increment a batch's enrolled counter) across a
  -- branch the actor has no scope over. Migration 0193.
  IF p_batch_id IS NOT NULL THEN
    SELECT branch_id INTO v_batch_branch FROM batches WHERE id = p_batch_id;
    IF v_batch_branch IS NULL THEN
      RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_batch_branch IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'forbidden: batch does not belong to this branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_discount_pct := COALESCE(p_discount_pct, 0);
  IF v_discount_pct < 0 OR v_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount percentage must be between 0 and 100' USING ERRCODE = '23514';
  END IF;

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

COMMIT;
