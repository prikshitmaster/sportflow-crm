-- ============================================================
-- 0098_fix_session_drill_rpc_uuid.sql
-- Fix type mismatches: session_plans, session_phases, drills,
-- and drill_favorites all use UUID primary keys, but the RPCs
-- in 0053 declared them as BIGINT → every update/delete/toggle
-- call fails with a type mismatch or 404.
-- ============================================================

-- ── DRILLS ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS secure_update_drill(BIGINT, JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_update_drill(
  p_id      UUID,
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID; v_row drills%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM drills WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE drills d SET
    name        = COALESCE(p_payload->>'name',        d.name),
    category    = COALESCE(p_payload->>'category',    d.category),
    sport_name  = COALESCE(p_payload->>'sport_name',  d.sport_name),
    age_group   = COALESCE(p_payload->>'age_group',   d.age_group),
    duration    = COALESCE(NULLIF(p_payload->>'duration','')::INTEGER, d.duration),
    min_players = COALESCE(NULLIF(p_payload->>'min_players','')::INTEGER, d.min_players),
    max_players = COALESCE(NULLIF(p_payload->>'max_players','')::INTEGER, d.max_players),
    difficulty  = COALESCE(p_payload->>'difficulty',  d.difficulty),
    equipment       = CASE WHEN p_payload ? 'equipment'       THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'equipment'))       ELSE d.equipment END,
    tags            = CASE WHEN p_payload ? 'tags'            THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags'))            ELSE d.tags END,
    area            = COALESCE(p_payload->>'area',        d.area),
    context_ct      = COALESCE(p_payload->>'context_ct',  d.context_ct),
    context_mt      = COALESCE(p_payload->>'context_mt',  d.context_mt),
    procedure       = CASE WHEN p_payload ? 'procedure'       THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'procedure'))       ELSE d.procedure END,
    coaching_points = CASE WHEN p_payload ? 'coaching_points' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'coaching_points')) ELSE d.coaching_points END,
    progressions    = CASE WHEN p_payload ? 'progressions'    THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'progressions'))    ELSE d.progressions END,
    regressions     = CASE WHEN p_payload ? 'regressions'     THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'regressions'))     ELSE d.regressions END,
    objectives      = CASE WHEN p_payload ? 'objectives'      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'objectives'))      ELSE d.objectives END,
    diagram_url    = COALESCE(NULLIF(p_payload->>'diagram_url',''),    d.diagram_url),
    diagram_preset = COALESCE(NULLIF(p_payload->>'diagram_preset',''), d.diagram_preset),
    video_url   = COALESCE(NULLIF(p_payload->>'video_url',''),         d.video_url)
  WHERE d.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_drill(UUID, JSONB, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS secure_delete_drill(BIGINT, TEXT);
CREATE OR REPLACE FUNCTION secure_delete_drill(
  p_id    UUID,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM drills WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM drills WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_drill(UUID, TEXT) TO anon, authenticated;

-- ── DRILL FAVORITES ─────────────────────────────────────────

DROP FUNCTION IF EXISTS secure_toggle_drill_favorite(BIGINT, BIGINT, TEXT);
CREATE OR REPLACE FUNCTION secure_toggle_drill_favorite(
  p_drill_id UUID,
  p_staff_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_existing UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_existing FROM drill_favorites
  WHERE drill_id = p_drill_id AND staff_id = p_staff_id;
  IF FOUND THEN
    DELETE FROM drill_favorites WHERE id = v_existing;
    RETURN false;
  ELSE
    INSERT INTO drill_favorites (drill_id, staff_id, academy_id) VALUES (p_drill_id, p_staff_id, a.academy_id);
    RETURN true;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_toggle_drill_favorite(UUID, BIGINT, TEXT) TO anon, authenticated;

-- ── SESSION PLANS ───────────────────────────────────────────

DROP FUNCTION IF EXISTS secure_update_session_plan(BIGINT, JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_update_session_plan(
  p_id      UUID,
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID; v_row session_plans%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM session_plans WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE session_plans sp SET
    topic        = COALESCE(p_payload->>'topic',       sp.topic),
    objective    = COALESCE(p_payload->>'objective',    sp.objective),
    venue        = COALESCE(p_payload->>'venue',        sp.venue),
    status       = COALESCE(p_payload->>'status',       sp.status),
    notes        = COALESCE(p_payload->>'notes',        sp.notes),
    formation    = COALESCE(p_payload->>'formation',    sp.formation),
    grid_size    = COALESCE(p_payload->>'grid_size',    sp.grid_size),
    num_players  = COALESCE(NULLIF(p_payload->>'num_players','')::INTEGER,  sp.num_players),
    total_duration = COALESCE(NULLIF(p_payload->>'total_duration','')::INTEGER, sp.total_duration),
    date         = COALESCE(NULLIF(p_payload->>'date','')::DATE, sp.date),
    batch_id     = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, sp.batch_id),
    coach_id     = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, sp.coach_id),
    equipment    = CASE WHEN p_payload ? 'equipment' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'equipment')) ELSE sp.equipment END,
    is_template  = COALESCE(NULLIF(p_payload->>'is_template','')::BOOLEAN, sp.is_template),
    template_name = COALESCE(p_payload->>'template_name', sp.template_name),
    completed_at = CASE WHEN p_payload ? 'completed_at' THEN NULLIF(p_payload->>'completed_at','')::TIMESTAMPTZ ELSE sp.completed_at END,
    updated_at   = now()
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_plan(UUID, JSONB, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS secure_delete_session_plan(BIGINT, TEXT);
CREATE OR REPLACE FUNCTION secure_delete_session_plan(
  p_id    UUID,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM session_plans WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM session_plans WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_session_plan(UUID, TEXT) TO anon, authenticated;

-- ── SESSION PHASES ──────────────────────────────────────────

DROP FUNCTION IF EXISTS secure_update_session_phase(BIGINT, JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_update_session_phase(
  p_id      UUID,
  p_updates JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row session_phases%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE session_phases sp SET
    phase_name  = COALESCE(p_updates->>'phase_name', sp.phase_name),
    area        = COALESCE(p_updates->>'area',       sp.area),
    context_ct  = COALESCE(p_updates->>'context_ct', sp.context_ct),
    context_mt  = COALESCE(p_updates->>'context_mt', sp.context_mt),
    duration    = COALESCE(NULLIF(p_updates->>'duration','')::INTEGER, sp.duration),
    position    = COALESCE(NULLIF(p_updates->>'position','')::INTEGER, sp.position),
    drill_id    = CASE WHEN p_updates ? 'drill_id' THEN NULLIF(p_updates->>'drill_id','')::UUID ELSE sp.drill_id END,
    procedure   = COALESCE(p_updates->'procedure',       sp.procedure),
    coaching_points = COALESCE(p_updates->'coaching_points', sp.coaching_points),
    diagram_url = COALESCE(NULLIF(p_updates->>'diagram_url',''), sp.diagram_url)
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_phase(UUID, JSONB, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS secure_delete_session_phase(BIGINT, TEXT);
CREATE OR REPLACE FUNCTION secure_delete_session_phase(
  p_id    UUID,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM session_phases WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_session_phase(UUID, TEXT) TO anon, authenticated;

-- Fix reorder: id is UUID not BIGINT
DROP FUNCTION IF EXISTS secure_reorder_session_phases(JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_reorder_session_phases(
  p_updates JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; r RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT (u->>'id')::UUID AS id, (u->>'position')::INTEGER AS pos
           FROM jsonb_array_elements(p_updates) u
  LOOP
    UPDATE session_phases SET position = r.pos WHERE id = r.id;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_reorder_session_phases(JSONB, TEXT) TO anon, authenticated;

-- Fix create_session_phase: id needs to be generated like session_plans
-- (jsonb_populate_record sets missing columns to NULL, bypassing defaults)
DROP FUNCTION IF EXISTS secure_create_session_phase(JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_create_session_phase(
  p_phase JSONB,
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row session_phases%ROWTYPE; v_phase JSONB;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Ensure id is populated (jsonb_populate_record bypasses DEFAULT)
  v_phase := p_phase;
  IF NOT (v_phase ? 'id') OR v_phase->>'id' IS NULL THEN
    v_phase := v_phase || jsonb_build_object('id', gen_random_uuid());
  END IF;
  INSERT INTO session_phases SELECT * FROM jsonb_populate_record(null::session_phases, v_phase)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_session_phase(JSONB, TEXT) TO anon, authenticated;

-- Fix insert_session_phases (bulk): same id issue
DROP FUNCTION IF EXISTS secure_insert_session_phases(JSONB, TEXT);
CREATE OR REPLACE FUNCTION secure_insert_session_phases(
  p_phases JSONB,
  p_token  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_phase JSONB; v_phases JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Ensure each phase has an id
  FOR v_phase IN SELECT value FROM jsonb_array_elements(p_phases) LOOP
    IF NOT (v_phase ? 'id') OR v_phase->>'id' IS NULL THEN
      v_phase := v_phase || jsonb_build_object('id', gen_random_uuid());
    END IF;
    v_phases := v_phases || jsonb_build_array(v_phase);
  END LOOP;
  INSERT INTO session_phases
  SELECT * FROM jsonb_populate_recordset(null::session_phases, v_phases);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_session_phases(JSONB, TEXT) TO anon, authenticated;
