-- ============================================================
-- 0191 — secure_update_student gains lastBatchName/lastBatchId
-- ============================================================
-- WHAT
--   Two new optional payload keys on the existing secure_update_student
--   RPC: lastBatchName -> last_batch_name, lastBatchId -> last_batch_id.
--   Same signature (p_student_id, p_payload, p_token) — CREATE OR REPLACE,
--   no DROP needed.
--
-- WHY
--   Found auditing the new "Remove from Batch" action (Students.jsx
--   Inactive tab, shipped 2026-08-25): the Suspended/Inactive tables show
--   "Last Batch" as `s.lastBatchName || s.batch`. last_batch_name is
--   already a real column, but until now the ONLY thing that ever wrote
--   to it was the daily-overdue-check Edge Function's auto-suspend path
--   (direct table update, bypassing this RPC entirely — see
--   supabase/functions/daily-overdue-check/index.ts). The manual
--   suspendStudent() action never set it, so "Last Batch" for a manually-
--   suspended student was already silently relying on `s.batch` staying
--   populated as the real fallback — which worked, because manual suspend
--   never clears batch/batch_id.
--
--   Remove from Batch DOES clear batch/batch_id (that's its entire
--   purpose). For a manually-suspended student — the common case —
--   last_batch_name was never set, so clearing batch/batch_id left BOTH
--   halves of the `lastBatchName || batch` fallback empty: "Last Batch"
--   would silently go blank the moment someone used the new button.
--   Caught by a full-flow SQL test, not by reading the code — the write
--   path for last_batch_name simply didn't exist on the client side to
--   even attempt.
--
--   This migration adds the missing write path; the AppContext action is
--   updated in the same commit to actually use it — captures the
--   student's current batch into last_batch_name/last_batch_id in the
--   SAME call that clears batch/batch_id, so "Last Batch" keeps working
--   exactly like it already does for auto-suspended students.
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

COMMIT;
