-- ============================================================
-- 0099_fix_text_array_rpc_coalesce.sql
-- All text[] columns in session_plans, session_phases, drills
-- were being set with COALESCE(jsonb, text[]) which PG rejects.
-- Replace with CASE WHEN payload has key THEN ARRAY(...) ELSE old END.
-- ============================================================

-- ── 1. secure_update_session_plan ────────────────────────────────
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
    topic          = COALESCE(p_payload->>'topic',        sp.topic),
    objective      = COALESCE(p_payload->>'objective',    sp.objective),
    venue          = COALESCE(p_payload->>'venue',        sp.venue),
    status         = COALESCE(p_payload->>'status',       sp.status),
    notes          = COALESCE(p_payload->>'notes',        sp.notes),
    formation      = COALESCE(p_payload->>'formation',    sp.formation),
    grid_size      = COALESCE(p_payload->>'grid_size',    sp.grid_size),
    num_players    = COALESCE(NULLIF(p_payload->>'num_players','')::INTEGER,  sp.num_players),
    total_duration = COALESCE(NULLIF(p_payload->>'total_duration','')::INTEGER, sp.total_duration),
    date           = COALESCE(NULLIF(p_payload->>'date','')::DATE, sp.date),
    batch_id       = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, sp.batch_id),
    coach_id       = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, sp.coach_id),
    equipment      = CASE WHEN p_payload ? 'equipment'
                     THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'equipment'))
                     ELSE sp.equipment END,
    is_template    = COALESCE(NULLIF(p_payload->>'is_template','')::BOOLEAN, sp.is_template),
    template_name  = COALESCE(p_payload->>'template_name', sp.template_name),
    completed_at   = CASE WHEN p_payload ? 'completed_at'
                     THEN NULLIF(p_payload->>'completed_at','')::TIMESTAMPTZ
                     ELSE sp.completed_at END,
    updated_at     = now()
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_plan(UUID, JSONB, TEXT) TO anon, authenticated;

-- ── 2. secure_update_session_phase ───────────────────────────────
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
    phase_name      = COALESCE(p_updates->>'phase_name', sp.phase_name),
    area            = COALESCE(p_updates->>'area',       sp.area),
    context_ct      = COALESCE(p_updates->>'context_ct', sp.context_ct),
    context_mt      = COALESCE(p_updates->>'context_mt', sp.context_mt),
    duration        = COALESCE(NULLIF(p_updates->>'duration','')::INTEGER, sp.duration),
    position        = COALESCE(NULLIF(p_updates->>'position','')::INTEGER, sp.position),
    drill_id        = CASE WHEN p_updates ? 'drill_id'
                      THEN NULLIF(p_updates->>'drill_id','')::UUID
                      ELSE sp.drill_id END,
    procedure       = CASE WHEN p_updates ? 'procedure'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'procedure'))
                      ELSE sp.procedure END,
    coaching_points = CASE WHEN p_updates ? 'coaching_points'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'coaching_points'))
                      ELSE sp.coaching_points END,
    diagram_url     = COALESCE(NULLIF(p_updates->>'diagram_url',''), sp.diagram_url)
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_phase(UUID, JSONB, TEXT) TO anon, authenticated;

-- ── 3. secure_update_drill ───────────────────────────────────────
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
    name            = COALESCE(p_payload->>'name',        d.name),
    category        = COALESCE(p_payload->>'category',    d.category),
    sport_name      = COALESCE(p_payload->>'sport_name',  d.sport_name),
    age_group       = COALESCE(p_payload->>'age_group',   d.age_group),
    duration        = COALESCE(NULLIF(p_payload->>'duration','')::INTEGER, d.duration),
    min_players     = COALESCE(NULLIF(p_payload->>'min_players','')::INTEGER, d.min_players),
    max_players     = COALESCE(NULLIF(p_payload->>'max_players','')::INTEGER, d.max_players),
    difficulty      = COALESCE(p_payload->>'difficulty',  d.difficulty),
    equipment       = CASE WHEN p_payload ? 'equipment'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'equipment'))
                      ELSE d.equipment END,
    tags            = CASE WHEN p_payload ? 'tags'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags'))
                      ELSE d.tags END,
    area            = COALESCE(p_payload->>'area',        d.area),
    context_ct      = COALESCE(p_payload->>'context_ct',  d.context_ct),
    context_mt      = COALESCE(p_payload->>'context_mt',  d.context_mt),
    procedure       = CASE WHEN p_payload ? 'procedure'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'procedure'))
                      ELSE d.procedure END,
    coaching_points = CASE WHEN p_payload ? 'coaching_points'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'coaching_points'))
                      ELSE d.coaching_points END,
    progressions    = CASE WHEN p_payload ? 'progressions'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'progressions'))
                      ELSE d.progressions END,
    regressions     = CASE WHEN p_payload ? 'regressions'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'regressions'))
                      ELSE d.regressions END,
    objectives      = CASE WHEN p_payload ? 'objectives'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'objectives'))
                      ELSE d.objectives END,
    diagram_url     = COALESCE(NULLIF(p_payload->>'diagram_url',''),    d.diagram_url),
    diagram_preset  = COALESCE(NULLIF(p_payload->>'diagram_preset',''), d.diagram_preset),
    video_url       = COALESCE(NULLIF(p_payload->>'video_url',''),      d.video_url)
  WHERE d.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_drill(UUID, JSONB, TEXT) TO anon, authenticated;
