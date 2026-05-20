-- ============================================================
-- 0053 — Phase 11a: secure all remaining write surfaces
-- ============================================================
-- TABLES COVERED
--   gate_qr, sport_branches, academy_branches,
--   events, tournament_matches, staff_invites,
--   leave_requests, staff_attendance,
--   skill_assessments, player_goals,
--   drills, drill_favorites,
--   session_plans, session_phases,
--   activity_sessions
--   (staff_sessions / student_sessions logout paths)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- GATE QR
-- ════════════════════════════════════════════════════════════

-- Replaces: gate_qr DELETE + INSERT in getOrCreateGateQR / regenerateGateQR.
-- Owner calls this; token is generated server-side (no client forgery).
CREATE OR REPLACE FUNCTION secure_get_or_create_gate_qr(
  p_academy_name TEXT    DEFAULT 'Academy Gate',
  p_token        TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a      RECORD;
  v_row  gate_qr%ROWTYPE;
  v_tok  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage gate QR' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM gate_qr
  WHERE academy_id = a.academy_id ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN RETURN row_to_json(v_row); END IF;

  v_tok := encode(gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_get_or_create_gate_qr(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_regenerate_gate_qr(
  p_academy_name TEXT    DEFAULT 'Academy Gate',
  p_token        TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a      RECORD;
  v_row  gate_qr%ROWTYPE;
  v_tok  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage gate QR' USING ERRCODE = '42501';
  END IF;

  DELETE FROM gate_qr WHERE academy_id = a.academy_id;

  v_tok := encode(gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_regenerate_gate_qr(TEXT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- SPORT BRANCHES + ACADEMY BRANCHES  (owner-only)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_insert_sport_branch(
  p_sport_name  TEXT,
  p_branch_name TEXT,
  p_address     TEXT    DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row sport_branches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sport_branches (academy_id, sport_name, branch_name, address)
  VALUES (a.academy_id, p_sport_name, p_branch_name, NULLIF(p_address,''))
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id   BIGINT,
  p_branch_name TEXT    DEFAULT NULL,
  p_address     TEXT    DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE sport_branches SET
    branch_name = COALESCE(p_branch_name, branch_name),
    address     = p_address
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(BIGINT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_upsert_branch(
  p_name  TEXT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO academy_branches (academy_id, name)
  VALUES (a.academy_id, p_name)
  ON CONFLICT (academy_id, name) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_branch(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_branch(
  p_name  TEXT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM academy_branches WHERE academy_id = a.academy_id AND name = p_name;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_branch(TEXT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- EVENTS + TOURNAMENT MATCHES  (owner-only)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_insert_event(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row events%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
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
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE events SET
    title         = CASE WHEN p_payload ? 'title'        THEN p_payload->>'title'                                ELSE title         END,
    type          = CASE WHEN p_payload ? 'type'         THEN p_payload->>'type'                                 ELSE type          END,
    sport         = CASE WHEN p_payload ? 'sport'        THEN NULLIF(p_payload->>'sport','')                     ELSE sport         END,
    date          = CASE WHEN p_payload ? 'date'         THEN (p_payload->>'date')::DATE                         ELSE date          END,
    end_date      = CASE WHEN p_payload ? 'endDate'      THEN NULLIF(p_payload->>'endDate','')::DATE             ELSE end_date      END,
    venue         = CASE WHEN p_payload ? 'venue'        THEN NULLIF(p_payload->>'venue','')                     ELSE venue         END,
    description   = CASE WHEN p_payload ? 'description'  THEN NULLIF(p_payload->>'description','')               ELSE description   END,
    status        = CASE WHEN p_payload ? 'status'       THEN p_payload->>'status'                               ELSE status        END,
    audience_type = CASE WHEN p_payload ? 'audienceType' THEN p_payload->>'audienceType'                         ELSE audience_type END,
    audience_ids  = CASE WHEN p_payload ? 'audienceIds'  THEN p_payload->'audienceIds'                           ELSE audience_ids  END,
    flyer_url     = CASE WHEN p_payload ? 'flyerUrl'     THEN NULLIF(p_payload->>'flyerUrl','')                  ELSE flyer_url     END,
    bracket_type  = CASE WHEN p_payload ? 'bracketType'  THEN NULLIF(p_payload->>'bracketType','')               ELSE bracket_type  END,
    participants  = CASE WHEN p_payload ? 'participants'  THEN p_payload->'participants'                          ELSE participants  END
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
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT academy_id INTO v_acad FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM events WHERE id = p_event_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_event(BIGINT, TEXT) TO anon, authenticated;

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
    NULLIF(r->>'player1_id','')::TEXT,
    NULLIF(r->>'player1_name',''),
    NULLIF(r->>'player2_id','')::TEXT,
    NULLIF(r->>'player2_name',''),
    COALESCE((r->>'is_bye')::BOOLEAN, false),
    NULLIF(r->>'winner_id','')::TEXT,
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
    winner_id   = p_winner_id,
    winner_name = p_winner_name,
    score       = p_score,
    played_at   = now()
  WHERE id = p_match_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_tournament_match(BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_event_matches(
  p_event_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT academy_id INTO v_acad FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM tournament_matches WHERE event_id = p_event_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_event_matches(BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- STAFF INVITES  (owner-only)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_create_invite(
  p_name         TEXT,
  p_access_role  TEXT,
  p_permissions  JSONB,
  p_academy_name TEXT    DEFAULT NULL,
  p_token        TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a      RECORD;
  v_tok  TEXT;
  v_row  staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_tok := encode(gen_random_bytes(24), 'hex');
  INSERT INTO staff_invites (token, academy_id, academy_name, name, access_role, permissions, expires_at, used)
  VALUES (v_tok, a.academy_id, COALESCE(p_academy_name,''), p_name, p_access_role,
          COALESCE(p_permissions,'[]'::JSONB), now() + INTERVAL '7 days', false)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_invite(TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_invite(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT academy_id INTO v_acad FROM staff_invites WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM staff_invites WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_invite(BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- LEAVE REQUESTS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_create_leave_request(
  p_staff_id   BIGINT,
  p_staff_name TEXT,
  p_start_date DATE,
  p_end_date   DATE,
  p_reason     TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row leave_requests%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Staff may only submit for themselves
  IF a.actor_kind = 'staff' AND a.actor_id IS DISTINCT FROM p_staff_id THEN
    RAISE EXCEPTION 'forbidden: staff can only submit own leave' USING ERRCODE = '42501';
  END IF;
  INSERT INTO leave_requests (staff_id, staff_name, start_date, end_date, reason, status, academy_id)
  VALUES (p_staff_id, p_staff_name, p_start_date, p_end_date, p_reason, 'Pending', a.academy_id)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_leave_request(BIGINT, TEXT, DATE, DATE, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_leave_status(
  p_id     BIGINT,
  p_status TEXT,
  p_token  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only owners can approve/reject leave' USING ERRCODE = '42501';
  END IF;
  UPDATE leave_requests SET status = p_status WHERE id = p_id AND academy_id = a.academy_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_leave_status(BIGINT, TEXT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- STAFF ATTENDANCE  (staff clocks own)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_log_staff_attendance(
  p_profile_id    UUID,
  p_staff_name    TEXT,
  p_date          DATE,
  p_check_in_time TEXT,
  p_token         TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO staff_attendance (academy_id, profile_id, staff_name, check_in_date, check_in_time)
  VALUES (a.academy_id, p_profile_id, p_staff_name, p_date, p_check_in_time)
  ON CONFLICT (academy_id, profile_id, check_in_date) DO UPDATE SET
    check_in_time = EXCLUDED.check_in_time;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_log_staff_attendance(UUID, TEXT, DATE, TEXT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- SKILL ASSESSMENTS
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
  INSERT INTO skill_assessments (student_id, staff_id, batch_id, sport, assessed_month, scores, notes, academy_id)
  VALUES (
    (p_payload->>'studentId')::BIGINT,
    (p_payload->>'staffId')::BIGINT,
    NULLIF(p_payload->>'batchId','')::BIGINT,
    p_payload->>'sport',
    p_payload->>'month',
    p_payload->'scores',
    NULLIF(p_payload->>'notes',''),
    a.academy_id
  )
  ON CONFLICT (student_id, assessed_month, sport) DO UPDATE SET
    staff_id   = EXCLUDED.staff_id,
    batch_id   = EXCLUDED.batch_id,
    scores     = EXCLUDED.scores,
    notes      = EXCLUDED.notes
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_assessment(JSONB, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- PLAYER GOALS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_upsert_player_goal(
  p_student_id BIGINT,
  p_month      TEXT,
  p_goal_text  TEXT,
  p_staff_id   BIGINT  DEFAULT NULL,
  p_token      TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_txt TEXT;
  v_row player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_txt := trim(COALESCE(p_goal_text,''));
  IF v_txt = '' THEN
    DELETE FROM player_goals WHERE student_id = p_student_id AND month = p_month
      AND academy_id = a.academy_id;
    RETURN NULL;
  END IF;
  INSERT INTO player_goals (student_id, month, goal_text, staff_id, academy_id)
  VALUES (p_student_id, p_month, v_txt, p_staff_id, a.academy_id)
  ON CONFLICT (student_id, month) DO UPDATE SET
    goal_text = EXCLUDED.goal_text,
    staff_id  = EXCLUDED.staff_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_player_goal(BIGINT, TEXT, TEXT, BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- DRILLS + DRILL FAVORITES
-- ════════════════════════════════════════════════════════════

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
  -- Force academy_id to caller's academy regardless of what client sends
  INSERT INTO drills SELECT * FROM jsonb_populate_record(null::drills, p_payload || jsonb_build_object('academy_id', a.academy_id))
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_drill(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_drill(
  p_id      BIGINT,
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
    title       = COALESCE(p_payload->>'title',       d.title),
    description = COALESCE(p_payload->>'description', d.description),
    duration    = COALESCE(NULLIF(p_payload->>'duration','')::INTEGER, d.duration),
    difficulty  = COALESCE(p_payload->>'difficulty',  d.difficulty),
    sport       = COALESCE(p_payload->>'sport',       d.sport),
    tags        = COALESCE(p_payload->'tags',         d.tags),
    diagram     = COALESCE(p_payload->'diagram',      d.diagram),
    video_url   = COALESCE(NULLIF(p_payload->>'video_url',''), d.video_url)
  WHERE d.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_drill(BIGINT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_drill(
  p_id    BIGINT,
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
GRANT EXECUTE ON FUNCTION secure_delete_drill(BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_toggle_drill_favorite(
  p_drill_id BIGINT,
  p_staff_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_existing BIGINT;
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
GRANT EXECUTE ON FUNCTION secure_toggle_drill_favorite(BIGINT, BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- SESSION PLANS + SESSION PHASES
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_create_session_plan(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row session_plans%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO session_plans SELECT * FROM jsonb_populate_record(null::session_plans,
    p_payload || jsonb_build_object('academy_id', a.academy_id))
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_session_plan(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_session_plan(
  p_id      BIGINT,
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
  UPDATE session_plans SET updated_at = now()
  WHERE id = p_id RETURNING * INTO v_row;
  -- Apply payload fields on top (jsonb_populate_record doesn't patch — use UPDATE … SET)
  UPDATE session_plans sp
  SET
    title        = COALESCE(p_payload->>'title',       sp.title),
    status       = COALESCE(p_payload->>'status',      sp.status),
    notes        = COALESCE(p_payload->>'notes',       sp.notes),
    date         = COALESCE(NULLIF(p_payload->>'date','')::DATE, sp.date),
    batch_id     = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, sp.batch_id),
    coach_id     = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, sp.coach_id),
    completed_at = CASE WHEN p_payload ? 'completed_at' THEN NULLIF(p_payload->>'completed_at','')::TIMESTAMPTZ ELSE sp.completed_at END,
    updated_at   = now()
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_plan(BIGINT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_session_plan(
  p_id    BIGINT,
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
GRANT EXECUTE ON FUNCTION secure_delete_session_plan(BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_insert_session_phases(
  p_phases JSONB,
  p_token  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO session_phases
  SELECT * FROM jsonb_populate_recordset(null::session_phases, p_phases);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_session_phases(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_create_session_phase(
  p_phase JSONB,
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row session_phases%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO session_phases SELECT * FROM jsonb_populate_record(null::session_phases, p_phase)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_session_phase(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_session_phase(
  p_id      BIGINT,
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
    title      = COALESCE(p_updates->>'title',    sp.title),
    duration   = COALESCE(NULLIF(p_updates->>'duration','')::INTEGER, sp.duration),
    position   = COALESCE(NULLIF(p_updates->>'position','')::INTEGER, sp.position),
    drill_id   = COALESCE(NULLIF(p_updates->>'drill_id','')::BIGINT,  sp.drill_id),
    notes      = COALESCE(p_updates->>'notes',    sp.notes),
    type       = COALESCE(p_updates->>'type',     sp.type)
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_session_phase(BIGINT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_session_phase(
  p_id    BIGINT,
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
GRANT EXECUTE ON FUNCTION secure_delete_session_phase(BIGINT, TEXT) TO anon, authenticated;

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
  FOR r IN SELECT (u->>'id')::BIGINT AS id, (u->>'position')::INTEGER AS pos
           FROM jsonb_array_elements(p_updates) u
  LOOP
    UPDATE session_phases SET position = r.pos WHERE id = r.id;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_reorder_session_phases(JSONB, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- ACTIVITY SESSIONS  (observability — minimal auth check)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_start_activity_session(
  p_user_type    TEXT,
  p_user_id      TEXT    DEFAULT NULL,
  p_user_name    TEXT    DEFAULT NULL,
  p_academy_id   UUID    DEFAULT NULL,
  p_academy_name TEXT    DEFAULT NULL,
  p_device       TEXT    DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uuid TEXT;
BEGIN
  INSERT INTO activity_sessions (user_type, user_id, user_name, academy_id, academy_name, device)
  VALUES (p_user_type, p_user_id, p_user_name, p_academy_id, p_academy_name, p_device)
  RETURNING session_uuid::TEXT INTO v_uuid;
  RETURN v_uuid;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_start_activity_session(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_heartbeat_activity_session(p_session_uuid TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE activity_sessions SET last_active_at = now() WHERE session_uuid = p_session_uuid::UUID;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_heartbeat_activity_session(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_end_activity_session(p_session_uuid TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_started TIMESTAMPTZ;
BEGIN
  SELECT started_at INTO v_started FROM activity_sessions WHERE session_uuid = p_session_uuid::UUID;
  UPDATE activity_sessions SET
    ended_at         = now(),
    last_active_at   = now(),
    duration_seconds = CASE WHEN v_started IS NOT NULL
                            THEN EXTRACT(EPOCH FROM (now() - v_started))::INTEGER
                            ELSE NULL END
  WHERE session_uuid = p_session_uuid::UUID;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_end_activity_session(TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- LOGOUT  (token-self-delete — no auth beyond knowing the token)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_logout_staff(p_token TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM staff_sessions WHERE token = p_token;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_logout_staff(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_logout_student(p_token TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM student_sessions WHERE token = p_token;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_logout_student(TEXT) TO anon, authenticated;
