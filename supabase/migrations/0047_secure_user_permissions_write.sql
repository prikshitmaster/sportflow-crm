-- ============================================================
-- 0047 — Phase 8a: secure user_permissions write RPCs
-- ============================================================
-- WHY
--   user_permissions_anon_all (from 0032) is the last privilege-escalation
--   vector: any anon caller can grant themselves owner access:
--     supabase.from('user_permissions')
--       .insert({ user_id: myUid, access_role: 'owner', academy_id: X })
--   This migration covers all 3 write paths so the raw policy can be
--   dropped in 0048.
--
-- RPCs ADDED / UPDATED
--   1. secure_complete_invite_signup   — UPDATED to also write user_permissions
--      (was: staff HR row + mark invite; now also: user_permissions upsert)
--   2. secure_update_user_permissions  — owner edits another user's role/perms
--   3. secure_revoke_user_permissions  — owner deletes another user's access
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_complete_invite_signup (updated) ────────────
-- Extended from 0045 to also write user_permissions for the new user.
-- auth.uid() is the newly-signed-up user; invite supplies the permissions.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_complete_invite_signup(
  p_invite_token TEXT,
  p_role_label   TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite   RECORD;
  v_staff_id BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite
  FROM staff_invites
  WHERE token  = p_invite_token
    AND used   = false
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite link is invalid or has expired' USING ERRCODE = '42501';
  END IF;

  -- HR staff record
  INSERT INTO staff (name, role, phone, sports, salary, join_date, status, attendance, academy_id)
  VALUES (
    v_invite.name,
    p_role_label,
    '',
    '[]'::JSONB,
    0,
    CURRENT_DATE,
    'Active',
    100,
    v_invite.academy_id
  )
  RETURNING id INTO v_staff_id;

  -- User permissions for the new authenticated user
  INSERT INTO user_permissions (user_id, academy_id, access_role, permissions, name, updated_at)
  VALUES (
    auth.uid(),
    v_invite.academy_id,
    v_invite.access_role,
    COALESCE(v_invite.permissions, '[]'::JSONB),
    v_invite.name,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    academy_id  = EXCLUDED.academy_id,
    access_role = EXCLUDED.access_role,
    permissions = EXCLUDED.permissions,
    name        = EXCLUDED.name,
    updated_at  = now();

  -- Mark invite consumed
  UPDATE staff_invites SET used = true WHERE token = p_invite_token;

  RETURN v_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_complete_invite_signup(TEXT, TEXT) TO authenticated;


-- ── 2. secure_update_user_permissions ────────────────────
-- Owner-only: edit another user's access_role and permissions.
-- Academy scope: the target user_permissions row must belong to
-- the caller's academy.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_user_permissions(
  p_user_id     UUID,
  p_access_role TEXT,
  p_permissions JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
  v_target_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(NULL) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can edit user permissions'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_target_academy
  FROM user_permissions WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy permission edit' USING ERRCODE = '42501';
  END IF;

  UPDATE user_permissions SET
    access_role = p_access_role,
    permissions = p_permissions,
    updated_at  = now()
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_user_permissions(UUID, TEXT, JSONB) TO authenticated;


-- ── 3. secure_revoke_user_permissions ────────────────────
-- Owner-only: remove another user's access entirely.
-- Academy scope enforced before DELETE.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_revoke_user_permissions(
  p_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
  v_target_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(NULL) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can revoke user access'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_target_academy
  FROM user_permissions WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy revoke' USING ERRCODE = '42501';
  END IF;

  DELETE FROM user_permissions WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_revoke_user_permissions(UUID) TO authenticated;
