-- ============================================================
-- 0041 — Phase 5a: secure staff UPDATE RPCs
-- ============================================================
-- WHY
--   staff_auth has a wide-open anon_full policy (from 0032). A coach
--   with the anon key can escalate their own privileges via DevTools:
--     supabase.from('staff_auth')
--       .update({ permissions: ['payments.manage','students.manage',...] })
--       .eq('staff_id', myId)
--   This is privilege escalation — a coach giving themselves owner-level
--   access. This migration adds SECURITY DEFINER RPCs covering all staff
--   UPDATE paths so the anon UPDATE hole can be closed in migration 0042.
--
-- RPCs ADDED
--   1. secure_update_staff_permissions — owner-only permission editing
--   2. secure_activate_staff_account   — self-service activation (join_code credential)
--   3. secure_update_staff_profile     — profile edit for staff + staff_profiles tables
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_update_staff_permissions ───────────────────
-- Only academy owners may change a staff member's access_role or
-- permissions. _require_perm would allow any staff with a perm, so
-- we check actor_kind = 'owner' explicitly here.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_staff_permissions(
  p_staff_id    BIGINT,
  p_access_role TEXT,
  p_permissions JSONB,
  p_token       TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can modify staff permissions'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_staff_academy FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy permission edit' USING ERRCODE = '42501';
  END IF;

  UPDATE staff_auth SET
    access_role = p_access_role,
    permissions = p_permissions
  WHERE staff_id = p_staff_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_staff_permissions(BIGINT, TEXT, JSONB, TEXT) TO anon, authenticated;


-- ── 2. secure_activate_staff_account ─────────────────────
-- Staff self-service activation. join_code is the credential —
-- no actor token required. Validates code server-side and sets
-- password_hash + marks account active.
-- Returns the staff row so the caller can create an audit log entry.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_activate_staff_account(
  p_staff_code    TEXT,
  p_join_code     TEXT,
  p_password_hash TEXT,
  p_email         TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth   staff_auth%ROWTYPE;
  v_staff  staff%ROWTYPE;
BEGIN
  SELECT * INTO v_auth
  FROM staff_auth
  WHERE staff_code = upper(p_staff_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff ID not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_auth.status = 'active' THEN
    RAISE EXCEPTION 'Account already activated — go to login.' USING ERRCODE = '23505';
  END IF;
  IF v_auth.join_code IS DISTINCT FROM upper(p_join_code) THEN
    RAISE EXCEPTION 'Incorrect Join Code' USING ERRCODE = '42501';
  END IF;

  UPDATE staff_auth SET
    password_hash = p_password_hash,
    status        = 'active',
    join_code     = NULL,
    email         = lower(trim(p_email))
  WHERE id = v_auth.id;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id;
  RETURN row_to_json(v_staff);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_activate_staff_account(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;


-- ── 3. secure_update_staff_profile ───────────────────────
-- Handles profile writes on both staff (name/phone/photo_url) and
-- staff_profiles (age/licence_url). Staff may update their own
-- profile; owners may update any staff in their academy.
-- Only fields present in p_payload are written — absent fields
-- retain their current DB values.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_staff_profile(
  p_staff_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_staff_academy FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'staff' THEN
    -- Staff may only update their own profile
    IF a.actor_id IS DISTINCT FROM p_staff_id THEN
      RAISE EXCEPTION 'forbidden: staff can only update their own profile' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- owner: must be same academy
    IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Update staff table for name/phone/photo_url fields
  IF p_payload ? 'name' OR p_payload ? 'phone' OR p_payload ? 'photoUrl' THEN
    UPDATE staff SET
      name      = CASE WHEN p_payload ? 'name'     THEN COALESCE(NULLIF(p_payload->>'name',''), name)  ELSE name      END,
      phone     = CASE WHEN p_payload ? 'phone'    THEN COALESCE(p_payload->>'phone', '')               ELSE phone     END,
      photo_url = CASE WHEN p_payload ? 'photoUrl' THEN NULLIF(p_payload->>'photoUrl','')               ELSE photo_url END
    WHERE id = p_staff_id;
  END IF;

  -- Upsert staff_profiles for age/licenceUrl fields
  IF p_payload ? 'age' OR p_payload ? 'licenceUrl' THEN
    INSERT INTO staff_profiles (staff_id, age, licence_url, updated_at)
    VALUES (
      p_staff_id,
      NULLIF(p_payload->>'age','')::INT,
      NULLIF(p_payload->>'licenceUrl',''),
      now()
    )
    ON CONFLICT (staff_id) DO UPDATE SET
      age         = CASE WHEN p_payload ? 'age'        THEN NULLIF(p_payload->>'age','')::INT   ELSE staff_profiles.age         END,
      licence_url = CASE WHEN p_payload ? 'licenceUrl' THEN NULLIF(p_payload->>'licenceUrl','') ELSE staff_profiles.licence_url END,
      updated_at  = now();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_staff_profile(BIGINT, JSONB, TEXT) TO anon, authenticated;
