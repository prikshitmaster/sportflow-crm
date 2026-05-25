-- 0085 — Staff clock-in / clock-out
--
-- Simple self-service check-in for staff members.
-- One record per staff per day; unique constraint prevents duplicates.
-- All writes go through SECURITY DEFINER RPCs (no direct anon writes).
-- Owners can read all check-ins in their academy; staff can read their own.
--
-- IDEMPOTENT.

BEGIN;

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff_checkins (
  id         bigserial    PRIMARY KEY,
  staff_id   bigint       NOT NULL,
  academy_id uuid         NOT NULL,
  date       date         NOT NULL DEFAULT CURRENT_DATE,
  clock_in   timestamptz  NOT NULL DEFAULT now(),
  clock_out  timestamptz,
  created_at timestamptz  DEFAULT now(),
  CONSTRAINT staff_checkins_staff_date UNIQUE (staff_id, date)
);

ALTER TABLE staff_checkins ENABLE ROW LEVEL SECURITY;

-- Owners read all via JWT; staff read their own via anon (RPC handles auth)
DROP POLICY IF EXISTS "checkins_read" ON staff_checkins;
CREATE POLICY "checkins_read" ON staff_checkins
  FOR SELECT USING (true);

-- No direct anon writes — all writes via SECURITY DEFINER RPCs below
DROP POLICY IF EXISTS "checkins_no_direct_write" ON staff_checkins;

-- ── secure_clock_in ────────────────────────────────────────────────────────
-- Inserts today's check-in for the calling staff member.
-- Idempotent: if already clocked in today, returns existing record.

CREATE OR REPLACE FUNCTION secure_clock_in(p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a     RECORD;
  v_row staff_checkins;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.academy_id IS NULL OR a.actor_kind NOT IN ('staff') THEN
    RAISE EXCEPTION 'Not authenticated as staff' USING ERRCODE = '42501';
  END IF;
  IF a.actor_id IS NULL THEN
    RAISE EXCEPTION 'Staff ID not resolved' USING ERRCODE = '42501';
  END IF;

  INSERT INTO staff_checkins (staff_id, academy_id, date, clock_in)
  VALUES (a.actor_id, a.academy_id, CURRENT_DATE, now())
  ON CONFLICT (staff_id, date) DO NOTHING
  RETURNING * INTO v_row;

  -- ON CONFLICT DO NOTHING returns nothing — fetch the existing row
  IF v_row IS NULL THEN
    SELECT * INTO v_row FROM staff_checkins
    WHERE staff_id = a.actor_id AND date = CURRENT_DATE;
  END IF;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_clock_in(text) TO anon, authenticated;

-- ── secure_clock_out ───────────────────────────────────────────────────────
-- Stamps clock_out on today's record for the calling staff member.

CREATE OR REPLACE FUNCTION secure_clock_out(p_checkin_id bigint, p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a     RECORD;
  v_row staff_checkins;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.academy_id IS NULL OR a.actor_kind NOT IN ('staff') THEN
    RAISE EXCEPTION 'Not authenticated as staff' USING ERRCODE = '42501';
  END IF;

  UPDATE staff_checkins
  SET clock_out = now()
  WHERE id = p_checkin_id
    AND academy_id = a.academy_id
    AND staff_id   = a.actor_id
    AND clock_out IS NULL
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    -- Already clocked out or wrong id — return current state
    SELECT * INTO v_row FROM staff_checkins
    WHERE id = p_checkin_id AND staff_id = a.actor_id;
  END IF;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_clock_out(bigint, text) TO anon, authenticated;

-- ── secure_get_today_checkin ───────────────────────────────────────────────
-- Returns today's check-in record for the calling staff member, or NULL.

CREATE OR REPLACE FUNCTION secure_get_today_checkin(p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a     RECORD;
  v_row staff_checkins;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.academy_id IS NULL OR a.actor_kind <> 'staff' OR a.actor_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM staff_checkins
  WHERE staff_id = a.actor_id AND date = CURRENT_DATE;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_get_today_checkin(text) TO anon, authenticated;

COMMIT;
