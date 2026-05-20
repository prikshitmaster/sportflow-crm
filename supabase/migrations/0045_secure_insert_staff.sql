-- ============================================================
-- 0045 — Phase 7a: secure staff INSERT RPC
-- ============================================================
-- WHY
--   staff_anon_insert + staff_auth_anon_insert (kept in 0042 for insertStaff)
--   let any anon caller create a fake staff member:
--     supabase.from('staff').insert({ name: 'hacker', academy_id: X, ... })
--     supabase.from('staff_auth').insert({ staff_id: Y, staff_code: 'FC001', join_code: 'XXXX' })
--   This migration adds a single SECURITY DEFINER RPC covering the full
--   insertStaff path so the raw INSERT policies can be dropped in 0046.
--
-- RPCs ADDED
--   1. secure_insert_staff            — owner-only staff creation (staff + optional staff_auth row)
--   2. secure_complete_invite_signup   — creates HR staff record for Supabase Auth invite flow;
--                                        called after supabase.auth.signUp so auth.uid() is set;
--                                        validates the invite token as credential (no owner token needed)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── secure_insert_staff ───────────────────────────────────
-- Only academy owners may create new staff. Inserts into staff and,
-- if p_staff_code is supplied, also into staff_auth with status=pending.
-- Returns the new staff row id so the caller can construct the JS object.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_staff(
  p_token       TEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_phone       TEXT       DEFAULT '',
  p_sports      JSONB      DEFAULT '[]',
  p_salary      NUMERIC    DEFAULT 0,
  p_join_date   DATE       DEFAULT NULL,
  p_status      TEXT       DEFAULT 'Active',
  p_photo_url   TEXT       DEFAULT NULL,
  p_staff_code  TEXT       DEFAULT NULL,
  p_join_code   TEXT       DEFAULT NULL,
  p_staff_type  TEXT       DEFAULT 'coach'
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          RECORD;
  v_staff_id BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can add staff'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO staff (name, role, phone, sports, salary, join_date, status, attendance, photo_url, academy_id)
  VALUES (
    p_name,
    p_role,
    COALESCE(p_phone, ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    COALESCE(p_salary, 0),
    COALESCE(p_join_date, CURRENT_DATE),
    COALESCE(p_status, 'Active'),
    100,
    NULLIF(p_photo_url, ''),
    a.academy_id
  )
  RETURNING id INTO v_staff_id;

  IF p_staff_code IS NOT NULL AND p_staff_code <> '' THEN
    INSERT INTO staff_auth (staff_id, staff_code, join_code, status, staff_type)
    VALUES (
      v_staff_id,
      upper(p_staff_code),
      upper(p_join_code),
      'pending',
      COALESCE(p_staff_type, 'coach')
    );
  END IF;

  RETURN v_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_staff(TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;


-- ── 2. secure_complete_invite_signup ─────────────────────
-- Called from the acceptInvite JS flow immediately after supabase.auth.signUp.
-- The new user is now `authenticated` (Supabase Auth JWT set) but is NOT an owner,
-- so secure_insert_staff's owner-check would fail. Instead, the invite token
-- itself is the credential: we validate it against staff_invites and create the
-- HR staff record scoped to the invite's academy. Marks the invite as used.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_complete_invite_signup(
  p_invite_token TEXT,
  p_role_label   TEXT    -- display role string, e.g. 'Coach', 'Receptionist'
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite   RECORD;
  v_staff_id BIGINT;
BEGIN
  -- auth.uid() must be set — caller just completed Supabase Auth signUp
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Validate and fetch the invite
  SELECT * INTO v_invite
  FROM staff_invites
  WHERE token  = p_invite_token
    AND used   = false
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite link is invalid or has expired' USING ERRCODE = '42501';
  END IF;

  -- Create the HR staff record scoped to the invite's academy
  INSERT INTO staff (name, role, phone, sports, salary, join_date, status, attendance, academy_id)
  VALUES (
    v_invite.name,
    p_role_label,
    '',
    '{}'::text[],
    0,
    CURRENT_DATE,
    'Active',
    100,
    v_invite.academy_id
  )
  RETURNING id INTO v_staff_id;

  -- Mark invite consumed
  UPDATE staff_invites SET used = true WHERE token = p_invite_token;

  RETURN v_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_complete_invite_signup(TEXT, TEXT) TO authenticated;
