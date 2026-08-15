-- ═══════════════════════════════════════════════════════════════════════════
-- 0152 — students.medical_notes + students.relationship
--
-- The public /join form has collected both since 0136/0143, but only on the
-- `trials` row. The owner-side "Add Student" modal now asks the same two
-- questions, and converting a trial carries them across, so the columns have
-- to exist on `students` too — otherwise the same fact lives on the trial and
-- vanishes the moment the student is created.
--
-- `medical_notes` is self-reported by whoever filled the form, unverified.
-- Kept separate from any staff-owned note field on purpose, same reasoning as
-- trials.medical_notes (see 0136).
--
-- `relationship` is the student's relationship to the person who registered
-- them: 'Myself' | 'Sibling' | 'Daughter' | 'Son' | free text.
--
-- Idempotent. Apply with:
--   npx supabase db query --linked --file supabase/migrations/0152_student_medical_and_relationship.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS medical_notes TEXT,
  ADD COLUMN IF NOT EXISTS relationship  TEXT;

COMMENT ON COLUMN students.medical_notes IS 'Self-reported medical condition / allergy, unverified. Blank means "no condition declared".';
COMMENT ON COLUMN students.relationship  IS 'Student''s relationship to the registering adult: Myself | Sibling | Daughter | Son | free text.';

-- ── 2. secure_update_student — accept the two new keys ────────────────────
-- Verbatim copy of security-v3/02_branch_writes_core.sql (confirmed against
-- the live function body before writing this) with two extra CASE lines. The
-- `CASE WHEN p_payload ? 'key'` pattern means callers can send a two-key
-- payload and leave every other column untouched.
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
    branch_id       = CASE WHEN p_payload ? 'branchId'       THEN NULLIF(p_payload->>'branchId','')::UUID                   ELSE branch_id      END
  WHERE id = p_student_id;

  RETURN (SELECT row_to_json(s) FROM students s WHERE s.id = p_student_id);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student(BIGINT, JSONB, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
