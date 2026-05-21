-- 0060: Allow staff with events.manage to insert/update/delete events
-- WHY: secure_insert_event, secure_update_event, secure_delete_event were
--      owner-only (migration 0053). Staff with events.manage permission
--      got 'forbidden' when trying to create or edit events from other branches.
-- IDEMPOTENT — safe to re-run.

CREATE OR REPLACE FUNCTION secure_insert_event(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row events%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'events.manage');

  INSERT INTO events (title, type, sport, date, end_date, venue, description, status,
    academy_id, audience_type, audience_ids, flyer_url, bracket_type, participants)
  VALUES (
    p_payload->>'title',
    p_payload->>'type',
    NULLIF(p_payload->>'sport',''),
    (p_payload->>'date')::DATE,
    NULLIF(p_payload->>'endDate','')::DATE,
    NULLIF(p_payload->>'venue',''),
    NULLIF(p_payload->>'description',''),
    COALESCE(NULLIF(p_payload->>'status',''), 'Upcoming'),
    a.academy_id,
    COALESCE(NULLIF(p_payload->>'audienceType',''), 'all'),
    COALESCE(p_payload->'audienceIds', '[]'::JSONB),
    NULLIF(p_payload->>'flyerUrl',''),
    NULLIF(p_payload->>'bracketType',''),
    COALESCE(p_payload->'participants', '[]'::JSONB)
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_event(JSONB, TEXT) TO anon, authenticated;


CREATE OR REPLACE FUNCTION secure_update_event(
  p_event_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'events.manage');

  SELECT academy_id INTO v_acad FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE events SET
    title         = CASE WHEN p_payload ? 'title'        THEN p_payload->>'title'                        ELSE title         END,
    type          = CASE WHEN p_payload ? 'type'         THEN p_payload->>'type'                         ELSE type          END,
    sport         = CASE WHEN p_payload ? 'sport'        THEN NULLIF(p_payload->>'sport','')             ELSE sport         END,
    date          = CASE WHEN p_payload ? 'date'         THEN (p_payload->>'date')::DATE                 ELSE date          END,
    end_date      = CASE WHEN p_payload ? 'endDate'      THEN NULLIF(p_payload->>'endDate','')::DATE     ELSE end_date      END,
    venue         = CASE WHEN p_payload ? 'venue'        THEN NULLIF(p_payload->>'venue','')             ELSE venue         END,
    description   = CASE WHEN p_payload ? 'description'  THEN NULLIF(p_payload->>'description','')       ELSE description   END,
    status        = CASE WHEN p_payload ? 'status'       THEN p_payload->>'status'                       ELSE status        END,
    audience_type = CASE WHEN p_payload ? 'audienceType' THEN p_payload->>'audienceType'                 ELSE audience_type END,
    audience_ids  = CASE WHEN p_payload ? 'audienceIds'  THEN p_payload->'audienceIds'                   ELSE audience_ids  END,
    flyer_url     = CASE WHEN p_payload ? 'flyerUrl'     THEN NULLIF(p_payload->>'flyerUrl','')          ELSE flyer_url     END,
    bracket_type  = CASE WHEN p_payload ? 'bracketType'  THEN NULLIF(p_payload->>'bracketType','')       ELSE bracket_type  END,
    participants  = CASE WHEN p_payload ? 'participants'  THEN p_payload->'participants'                  ELSE participants  END
  WHERE id = p_event_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_event(BIGINT, JSONB, TEXT) TO anon, authenticated;


CREATE OR REPLACE FUNCTION secure_delete_event(
  p_event_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'events.manage');

  SELECT academy_id INTO v_acad FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM events WHERE id = p_event_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_event(BIGINT, TEXT) TO anon, authenticated;
