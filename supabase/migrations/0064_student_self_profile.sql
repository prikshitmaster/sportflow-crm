-- 0064: Student self-edit of football profile fields
-- WHY: students need to enter their own height/weight/preferred foot/wing
--      so the assessment PDF auto-populates. secure_update_student
--      requires students.manage perm (owner/staff only) — students can't
--      use it. This RPC is locked to actor_kind='student' AND
--      actor_id = p_student_id, and only touches the 4 football fields.
-- IDEMPOTENT — safe to re-run.

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
    height_cm      = CASE WHEN p_payload ? 'heightCm'      THEN NULLIF(p_payload->>'heightCm','')::INT  ELSE height_cm     END,
    weight_kg      = CASE WHEN p_payload ? 'weightKg'      THEN NULLIF(p_payload->>'weightKg','')::INT  ELSE weight_kg     END,
    preferred_foot = CASE WHEN p_payload ? 'preferredFoot' THEN NULLIF(p_payload->>'preferredFoot','')  ELSE preferred_foot END,
    wing           = CASE WHEN p_payload ? 'wing'          THEN NULLIF(p_payload->>'wing','')           ELSE wing          END
  WHERE id = p_student_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student_self_profile(BIGINT, JSONB, TEXT) TO anon, authenticated;
