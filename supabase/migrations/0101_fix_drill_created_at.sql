-- ============================================================
-- 0101_fix_drill_created_at.sql
-- secure_create_drill used jsonb_populate_record which bypasses
-- DEFAULT now() for created_at, leaving it NULL.
-- Force-set created_at server-side like we do for academy_id.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_create_drill(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row drills%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO drills SELECT * FROM jsonb_populate_record(null::drills,
    p_payload
    || jsonb_build_object('academy_id', a.academy_id)
    || jsonb_build_object('created_at', now())
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_drill(JSONB, TEXT) TO anon, authenticated;
