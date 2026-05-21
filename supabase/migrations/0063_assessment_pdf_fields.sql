-- 0063: Fields needed for printable Football Assessment PDF
-- ADDITIVE — all columns nullable, all existing queries unaffected.
--
-- Adds:
--   students.height_cm, weight_kg, preferred_foot, wing  → for the
--     Personal Details block on the report
--   skill_assessments.category_notes JSONB  → coach-written paragraph
--     summary per category (technical, tactical, athleticism, personality)
--   Extends secure_update_student to accept the 4 new student fields
--   Extends secure_upsert_assessment to accept categoryNotes payload
--
-- IDEMPOTENT — safe to re-run.

-- ════════════════════════════════════════════════════════════
-- 1. Schema additions
-- ════════════════════════════════════════════════════════════

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS height_cm       INTEGER,
  ADD COLUMN IF NOT EXISTS weight_kg       INTEGER,
  ADD COLUMN IF NOT EXISTS preferred_foot  TEXT,    -- 'Left' | 'Right' | 'Both'
  ADD COLUMN IF NOT EXISTS wing            TEXT;    -- 'Left' | 'Right' | 'None'

ALTER TABLE skill_assessments
  ADD COLUMN IF NOT EXISTS category_notes  JSONB DEFAULT '{}'::jsonb;


-- ════════════════════════════════════════════════════════════
-- 2. Update secure_update_student to accept the 4 new fields
-- ════════════════════════════════════════════════════════════
-- We add the new CASE clauses while keeping every existing one. Re-running
-- this overwrites the function with the extended version.

CREATE OR REPLACE FUNCTION secure_update_student(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_acad  UUID;
  v_row   students%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id INTO v_acad FROM students WHERE id = p_student_id;
  IF v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    name          = CASE WHEN p_payload ? 'name'         THEN p_payload->>'name'                          ELSE name          END,
    parent        = CASE WHEN p_payload ? 'parent'       THEN p_payload->>'parent'                        ELSE parent        END,
    phone         = CASE WHEN p_payload ? 'phone'        THEN NULLIF(p_payload->>'phone','')              ELSE phone         END,
    parent_phone  = CASE WHEN p_payload ? 'parentPhone'  THEN NULLIF(p_payload->>'parentPhone','')        ELSE parent_phone  END,
    age           = CASE WHEN p_payload ? 'age'          THEN NULLIF(p_payload->>'age','')::INT           ELSE age           END,
    dob           = CASE WHEN p_payload ? 'dob'          THEN NULLIF(p_payload->>'dob','')::DATE          ELSE dob           END,
    sport         = CASE WHEN p_payload ? 'sport'        THEN p_payload->>'sport'                         ELSE sport         END,
    batch         = CASE WHEN p_payload ? 'batchName'    THEN p_payload->>'batchName'                     ELSE batch         END,
    batch_id      = CASE WHEN p_payload ? 'batchId'      THEN NULLIF(p_payload->>'batchId','')::BIGINT    ELSE batch_id      END,
    join_date     = CASE WHEN p_payload ? 'joinDate'     THEN NULLIF(p_payload->>'joinDate','')::DATE     ELSE join_date     END,
    fees          = CASE WHEN p_payload ? 'fees'         THEN NULLIF(p_payload->>'fees','')::NUMERIC      ELSE fees          END,
    fee_amount    = CASE WHEN p_payload ? 'feeAmount'    THEN NULLIF(p_payload->>'feeAmount','')::NUMERIC ELSE fee_amount    END,
    paid_till     = CASE WHEN p_payload ? 'paidTill'     THEN NULLIF(p_payload->>'paidTill','')::DATE     ELSE paid_till     END,
    training_type = CASE WHEN p_payload ? 'trainingType' THEN COALESCE(NULLIF(p_payload->>'trainingType',''), 'Daily')
                                                              ELSE training_type END,
    fee_plan      = CASE WHEN p_payload ? 'feePlan'      THEN COALESCE(NULLIF(p_payload->>'feePlan',''), 'monthly')
                                                              ELSE fee_plan      END,
    position      = CASE WHEN p_payload ? 'position'     THEN NULLIF(p_payload->>'position','')           ELSE position      END,
    status        = CASE WHEN p_payload ? 'status'       THEN p_payload->>'status'                        ELSE status        END,
    photo_url     = CASE WHEN p_payload ? 'photoUrl'     THEN NULLIF(p_payload->>'photoUrl','')           ELSE photo_url     END,
    height_cm     = CASE WHEN p_payload ? 'heightCm'     THEN NULLIF(p_payload->>'heightCm','')::INT      ELSE height_cm     END,
    weight_kg     = CASE WHEN p_payload ? 'weightKg'     THEN NULLIF(p_payload->>'weightKg','')::INT      ELSE weight_kg     END,
    preferred_foot= CASE WHEN p_payload ? 'preferredFoot' THEN NULLIF(p_payload->>'preferredFoot','')     ELSE preferred_foot END,
    wing          = CASE WHEN p_payload ? 'wing'         THEN NULLIF(p_payload->>'wing','')               ELSE wing          END
  WHERE id = p_student_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student(BIGINT, JSONB, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 3. Update secure_upsert_assessment to accept categoryNotes
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_upsert_assessment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row skill_assessments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO skill_assessments (
    student_id, staff_id, batch_id, sport, assessed_month, scores, notes,
    academy_id, category_notes
  ) VALUES (
    (p_payload->>'studentId')::BIGINT,
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
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_assessment(JSONB, TEXT) TO anon, authenticated;
