-- Fix: secure_insert_tournament_matches / secure_update_tournament_match cast
-- player1_id/player2_id/winner_id to ::TEXT, but tournament_matches stores
-- them as BIGINT (see supabase/schema_events.sql) — every bracket draw and
-- every match-result save has failed with "column ... is of type bigint but
-- expression is of type text" since these RPCs were introduced in 0053.
-- Casts corrected to BIGINT; NULLIF still applied so empty-string payloads
-- (byes, unset winners) become NULL instead of raising an invalid-input error.

CREATE OR REPLACE FUNCTION secure_insert_tournament_matches(
  p_rows  JSONB,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  -- Verify event belongs to caller's academy
  SELECT academy_id INTO v_acad FROM events
  WHERE id = (p_rows->0->>'event_id')::BIGINT;
  IF v_acad IS DISTINCT FROM a.academy_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO tournament_matches (event_id, round, match_number, player1_id, player1_name,
    player2_id, player2_name, is_bye, winner_id, winner_name)
  SELECT
    (r->>'event_id')::BIGINT,
    (r->>'round')::INTEGER,
    (r->>'match_number')::INTEGER,
    NULLIF(r->>'player1_id','')::BIGINT,
    NULLIF(r->>'player1_name',''),
    NULLIF(r->>'player2_id','')::BIGINT,
    NULLIF(r->>'player2_name',''),
    COALESCE((r->>'is_bye')::BOOLEAN, false),
    NULLIF(r->>'winner_id','')::BIGINT,
    NULLIF(r->>'winner_name','')
  FROM jsonb_array_elements(p_rows) r;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_tournament_matches(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_tournament_match(
  p_match_id   BIGINT,
  p_winner_id   TEXT    DEFAULT NULL,
  p_winner_name TEXT    DEFAULT NULL,
  p_score       TEXT    DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT e.academy_id INTO v_acad FROM tournament_matches m JOIN events e ON e.id = m.event_id WHERE m.id = p_match_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE tournament_matches SET
    winner_id   = NULLIF(p_winner_id, '')::BIGINT,
    winner_name = p_winner_name,
    score       = p_score,
    played_at   = now()
  WHERE id = p_match_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_tournament_match(BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
