-- ============================================================
-- 0104 — Replace the "Wing" self-profile field with "Position"
-- ============================================================
-- WHY
--   'wing' was a crude Left/Right/None field entered by the student,
--   sitting right next to the *real* pitch position system
--   (students.position, FOOTBALL_POSITIONS catalog — GK/RB/.../LW/ST/RW)
--   that the app already uses everywhere else (Batches pitch view,
--   Reports, StudentStats, StaffAssess, the assessment PDF). The
--   assessment PDF even showed both "Position" and "Wing" side by
--   side — redundant. This migration makes secure_update_student_self_profile
--   accept 'position' instead of 'wing', so students self-select their
--   real pitch position instead of a separate, lower-fidelity field.
--
--   students.wing is left in place (unused) rather than dropped —
--   removing a column is harder to reverse than leaving a dead one.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_update_student_self_profile(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row students%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden: students only' USING ERRCODE = '42501';
  END IF;
  IF a.actor_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'forbidden: can only edit own profile' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    height_cm      = CASE WHEN p_payload ? 'heightCm'      THEN NULLIF(p_payload->>'heightCm','')::INT  ELSE height_cm      END,
    weight_kg      = CASE WHEN p_payload ? 'weightKg'      THEN NULLIF(p_payload->>'weightKg','')::INT  ELSE weight_kg      END,
    preferred_foot = CASE WHEN p_payload ? 'preferredFoot' THEN NULLIF(p_payload->>'preferredFoot','')  ELSE preferred_foot END,
    position       = CASE WHEN p_payload ? 'position'      THEN NULLIF(p_payload->>'position','')       ELSE position       END,
    crs_number     = CASE WHEN p_payload ? 'crsNumber'     THEN NULLIF(p_payload->>'crsNumber','')      ELSE crs_number     END
  WHERE id = p_student_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student_self_profile(BIGINT, JSONB, TEXT) TO anon, authenticated;
