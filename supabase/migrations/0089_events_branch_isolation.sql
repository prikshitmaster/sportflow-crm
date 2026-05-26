-- 0089: Branch-scope events.
--
-- The events table had no branch_id, so events were only sport-isolated — an
-- event made in one branch showed in every branch of that sport. Add branch_id
-- and tag it on insert (from the creator's branch). NULL = academy-wide
-- (visible to all branches), so existing rows keep showing everywhere (no
-- regression); only newly branch-tagged events isolate.

ALTER TABLE events ADD COLUMN IF NOT EXISTS branch_id uuid;
CREATE INDEX IF NOT EXISTS events_branch_id_idx ON events(branch_id);

-- Set branch_id on insert: explicit payload branch wins, else the actor's own
-- branch (so a branch manager's events are tagged their branch automatically).
CREATE OR REPLACE FUNCTION public.secure_insert_event(p_payload jsonb, p_token text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE a RECORD; v_branch uuid; v_row events%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'events.manage');

  v_branch := NULLIF(p_payload->>'branchId','')::UUID;
  IF v_branch IS NULL THEN v_branch := a.branch_id; END IF;

  INSERT INTO events (title, type, sport, date, end_date, venue, description, status,
    academy_id, audience_type, audience_ids, flyer_url, bracket_type, participants, branch_id)
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
    COALESCE(p_payload->'participants', '[]'::JSONB),
    v_branch
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_insert_event(jsonb, text) TO anon, authenticated;
