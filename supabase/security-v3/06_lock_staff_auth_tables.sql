-- security-v3 / 06 — Lock staff_auth + staff_profiles (no more anon read)
--
-- Today these tables have open_access USING(true) for both anon and
-- authenticated. That means the anon key (which ships in the public JS
-- bundle) can read every staff member's password_hash. Closing this.
--
-- After this migration:
--   anon          → cannot read staff_auth / staff_profiles at all
--   authenticated → owners can read all rows in their academy only
--                   (needed for the Staff Management page)
--   RPCs          → unaffected (SECURITY DEFINER bypasses RLS)
--
-- Client changes required (applied in the same commit on the JS side):
--   - secure_login_staff now bundles age + licence_url
--     → fetchStaffProfileExtra direct-table call goes away
--   - new RPC secure_fetch_next_staff_code(type) for staff creation
--     → fetchNextStaffCode direct-table call goes away
--   - fetchStaff() in the Staff Management page keeps working because
--     authenticated owners get an academy-scoped SELECT policy below
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 1. Extend secure_login_staff: merge in age + licence_url from staff_profiles
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_login_staff(
  p_email         TEXT,
  p_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth     staff_auth%ROWTYPE;
  v_staff    staff%ROWTYPE;
  v_extra    staff_profiles%ROWTYPE;
  v_token    TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF p_email IS NULL OR p_password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_auth
  FROM staff_auth
  WHERE email = lower(trim(p_email))
    AND password_hash = p_password_hash
    AND status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff record not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_extra FROM staff_profiles WHERE staff_id = v_staff.id LIMIT 1;

  v_token   := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
  v_expires := now() + interval '30 days';

  INSERT INTO staff_sessions (staff_id, token, expires_at)
  VALUES (v_staff.id, v_token, v_expires);

  RETURN jsonb_build_object(
    'token',          v_token,
    'expires_at',     v_expires,
    'staff_code',     v_auth.staff_code,
    'staff_type',     COALESCE(v_auth.staff_type, 'coach'),
    'account_status', v_auth.status,
    'access_role',    COALESCE(v_auth.access_role, 'coach'),
    'permissions',    COALESCE(v_auth.permissions, '[]'::jsonb),
    'age',            v_extra.age,
    'licence_url',    v_extra.licence_url
  ) || to_jsonb(v_staff);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_login_staff(TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. New RPC: secure_fetch_next_staff_code(type)
--    Owner-only. Computes the next OF### / FC### code by reading
--    staff_auth via SECURITY DEFINER so anon doesn't need direct access.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_fetch_next_staff_code(
  p_type  TEXT,
  p_token TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_prefix TEXT;
  v_last   TEXT;
  v_num    INTEGER;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only owners can mint staff codes' USING ERRCODE = '42501';
  END IF;

  v_prefix := CASE WHEN p_type = 'office' THEN 'OF' ELSE 'FC' END;

  SELECT staff_code INTO v_last
  FROM staff_auth
  WHERE staff_code LIKE v_prefix || '%'
  ORDER BY staff_code DESC
  LIMIT 1;

  v_num := COALESCE(NULLIF(substring(v_last FROM length(v_prefix) + 1), '')::INTEGER, 0) + 1;
  RETURN v_prefix || lpad(v_num::TEXT, 3, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION secure_fetch_next_staff_code(TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. Drop old wide-open policies
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "open_access"                ON public.staff_auth;
DROP POLICY IF EXISTS "staff_auth_anon_select"     ON public.staff_auth;
DROP POLICY IF EXISTS "staff_auth_anon_insert"     ON public.staff_auth;
DROP POLICY IF EXISTS "staff_auth_anon_update"     ON public.staff_auth;
DROP POLICY IF EXISTS "staff_auth_anon_delete"     ON public.staff_auth;
DROP POLICY IF EXISTS "staff_auth_all"             ON public.staff_auth;

DROP POLICY IF EXISTS "open_access"                ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_anon_select" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_anon_insert" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_anon_update" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_anon_delete" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_all"         ON public.staff_profiles;

-- ════════════════════════════════════════════════════════════════
-- 4. Add owner-scoped SELECT policies (so the Staff Management page works)
--    Authenticated owners can read rows for staff in their own academy.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY "staff_auth_owner_read"
  ON public.staff_auth FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s
    WHERE s.id = staff_auth.staff_id
      AND s.academy_id = get_my_academy_id()
  ));

CREATE POLICY "staff_profiles_owner_read"
  ON public.staff_profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s
    WHERE s.id = staff_profiles.staff_id
      AND s.academy_id = get_my_academy_id()
  ));

-- RLS stays enabled
ALTER TABLE public.staff_auth     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

COMMIT;
