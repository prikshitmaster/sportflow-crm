-- ═══════════════════════════════════════════════════════════════════════════
-- 0153 — students gains the rest of the registration-form fields
--
-- The public /join form (trials) has collected all of these since 0136/0146,
-- but `students` had nowhere to put them: converting a trial silently dropped
-- the mother's name, address, gender, emergency contact and the rest. The
-- owner-side Add Student modal now asks the same questions, so both intake
-- paths finally produce the same record.
--
-- Column names deliberately mirror the `trials` columns one-for-one, so the
-- conversion path is a straight copy with no renaming to get wrong.
--
-- NOT added on purpose:
--   • preferred_days   — exists on trials only to place a prospect into a
--                        batch. Both intake forms that write a student pick
--                        the batch outright, so the preference has no reader.
--   • sibling_of_trial_id — links two TRIAL rows; meaningless once converted.
--   • document_path    — students use the document vault (0103) instead.
--
-- Idempotent. Apply with:
--   npx supabase db query --linked --file supabase/migrations/0153_student_registration_fields.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS mother_name             TEXT,
  ADD COLUMN IF NOT EXISTS email                   TEXT,
  ADD COLUMN IF NOT EXISTS alternate_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS occupation              TEXT,
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

COMMENT ON COLUMN students.occupation              IS 'Parent''s / guardian''s occupation, as asked on the registration form.';
COMMENT ON COLUMN students.emergency_contact_phone IS 'Free text, not normalised to 10 digits — a converted trial may carry a landline.';

-- ── 2. secure_update_student — accept the eight new keys ──────────────────
-- Same body as 0152 (itself a verbatim copy of security-v3/02) plus the new
-- CASE lines. The `CASE WHEN p_payload ? 'key'` pattern means a caller can
-- send any subset and leave every other column untouched.
CREATE OR REPLACE FUNCTION secure_update_student(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

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
$$;
GRANT EXECUTE ON FUNCTION secure_update_student(BIGINT, JSONB, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
