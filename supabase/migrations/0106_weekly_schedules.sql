-- ============================================================
-- 0106 — Weekly Training Schedule
-- ============================================================
-- A coach tool, deliberately separate from the drill/phase-based
-- session builder (session_plans/session_phases): a simple weekly
-- overview grid — Team Name / week range / Coach Name, then a 6-day
-- (Mon-Sat) x 4-row (Session Objective/Technical/Tactical/Match)
-- table of free-text cells.
--
-- week_start is always a Monday — the client derives the Mon-Sat
-- range/label from this single date, so the grid is invariantly
-- 6 columns. The grid itself is one JSONB blob, day-major
-- ({ "Monday": { objective, technical, tactical, match }, ... }),
-- always fully populated by the client (blank strings, not missing
-- keys) so reads never have to guess about partial rows.
--
-- created_at/updated_at are explicitly injected with now() in the
-- create RPC below (jsonb_populate_record bypasses column DEFAULTs
-- — the same gap migration 0101 had to fix reactively for drills;
-- avoiding it here from the start).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id  uuid   NOT NULL,
  batch_id    bigint NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  coach_id    bigint REFERENCES staff (id) ON DELETE SET NULL,
  coach_name  text   NOT NULL DEFAULT '',
  team_name   text   NOT NULL DEFAULT '',
  week_start  date   NOT NULL,
  grid        jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_schedules_batch_week_key UNIQUE (batch_id, week_start)
);
CREATE INDEX IF NOT EXISTS weekly_schedules_academy_idx ON weekly_schedules (academy_id);
CREATE INDEX IF NOT EXISTS weekly_schedules_batch_idx   ON weekly_schedules (batch_id);
CREATE INDEX IF NOT EXISTS weekly_schedules_coach_idx   ON weekly_schedules (coach_id);

ALTER TABLE weekly_schedules ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS ────────────────────────────────────────────────────
-- Staff (anon + custom session token) — academy-wide read, matching
-- the existing session_plans_anon_read pattern (no extra permission
-- gate at the RLS layer; the RPCs below gate writes).
DROP POLICY IF EXISTS weekly_schedules_anon_read ON public.weekly_schedules;
CREATE POLICY weekly_schedules_anon_read ON weekly_schedules FOR SELECT TO anon
  USING (academy_id = current_staff_academy());

-- Owner (real Supabase Auth session) — full access within own academy.
DROP POLICY IF EXISTS weekly_schedules_auth_all ON public.weekly_schedules;
CREATE POLICY weekly_schedules_auth_all ON weekly_schedules FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- No anon INSERT/UPDATE/DELETE policy — all writes go through the RPCs below.

-- ── 3. RPCs ───────────────────────────────────────────────────
-- training.manage gates writes (matches the existing route-level gate
-- on /sessions and /drills, and the default coach permission preset).
-- _require_perm lets owners through unconditionally and rejects students.

CREATE OR REPLACE FUNCTION secure_create_weekly_schedule(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row weekly_schedules%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  INSERT INTO weekly_schedules SELECT * FROM jsonb_populate_record(null::weekly_schedules,
    p_payload
    || jsonb_build_object('academy_id', a.academy_id)
    || jsonb_build_object('created_at', now())
    || jsonb_build_object('updated_at', now())
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_weekly_schedule(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_weekly_schedule(
  p_id      UUID,
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID; v_row weekly_schedules%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id INTO v_acad FROM weekly_schedules WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE weekly_schedules ws SET
    team_name  = COALESCE(p_payload->>'team_name',  ws.team_name),
    coach_name = COALESCE(p_payload->>'coach_name', ws.coach_name),
    batch_id   = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, ws.batch_id),
    coach_id   = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, ws.coach_id),
    week_start = COALESCE(NULLIF(p_payload->>'week_start','')::DATE, ws.week_start),
    grid       = COALESCE(p_payload->'grid', ws.grid),
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_weekly_schedule(UUID, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_weekly_schedule(
  p_id    UUID,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id INTO v_acad FROM weekly_schedules WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM weekly_schedules WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_weekly_schedule(UUID, TEXT) TO anon, authenticated;

COMMIT;
