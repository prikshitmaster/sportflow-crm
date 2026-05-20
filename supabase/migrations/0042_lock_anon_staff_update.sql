-- ============================================================
-- 0042 — Phase 5b: lock anon UPDATE on staff tables
-- ============================================================
-- WHY
--   Phase 5a (migration 0041) added 3 SECURITY DEFINER RPCs covering
--   all UPDATE paths on staff, staff_auth, and staff_profiles.
--   The remaining anon write policies allow privilege escalation:
--
--   staff:          staff_anon_update  (INSERT+UPDATE left from 0034)
--   staff_auth:     staff_auth_anon_full  (ALL ops from 0032)
--   staff_profiles: staff_profiles_anon_full  (ALL ops from 0032)
--
-- WHAT THIS DOES
--   staff table:
--     DROP staff_anon_update — UPDATE now only via secure_update_staff_profile
--     KEEP staff_anon_select, staff_anon_insert (insertStaff still raw INSERT)
--
--   staff_auth table:
--     DROP staff_auth_anon_full (ALL ops)
--     Recreate as SELECT + INSERT only:
--       SELECT needed for login / session validation / code lookup
--       INSERT needed for insertStaff (raw staff_auth.insert — not yet RPC)
--       UPDATE removed — now only via secure_activate_staff_account
--                        and secure_update_staff_permissions (SECURITY DEFINER)
--
--   staff_profiles table:
--     DROP staff_profiles_anon_full (ALL ops)
--     Recreate as SELECT only — all writes now via secure_update_staff_profile
--     (SECURITY DEFINER, bypasses RLS)
--
-- STAFF WRITE SURFACE AFTER THIS MIGRATION
--   permissions edit   → secure_update_staff_permissions (owner-only)
--   account activation → secure_activate_staff_account
--   profile update     → secure_update_staff_profile
--   new staff INSERT   → still raw (insertStaff — future stage)
--   SELECT             → wide-open (intentional)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── staff table: drop UPDATE only ────────────────────────
DROP POLICY IF EXISTS staff_anon_update ON public.staff;

-- Sanity: SELECT + INSERT should remain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'staff' AND policyname = 'staff_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY staff_anon_select ON public.staff FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'staff' AND policyname = 'staff_anon_insert'
  ) THEN
    EXECUTE 'CREATE POLICY staff_anon_insert ON public.staff FOR INSERT TO anon WITH CHECK (true)';
  END IF;
END $$;


-- ── staff_auth table: drop ALL, recreate SELECT + INSERT ─
DROP POLICY IF EXISTS staff_auth_anon_full ON public.staff_auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'staff_auth' AND policyname = 'staff_auth_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY staff_auth_anon_select ON public.staff_auth FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'staff_auth' AND policyname = 'staff_auth_anon_insert'
  ) THEN
    EXECUTE 'CREATE POLICY staff_auth_anon_insert ON public.staff_auth FOR INSERT TO anon WITH CHECK (true)';
  END IF;
END $$;


-- ── staff_profiles table: drop ALL, recreate SELECT only ─
-- All writes go through secure_update_staff_profile (SECURITY DEFINER).
DROP POLICY IF EXISTS staff_profiles_anon_full ON public.staff_profiles;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'staff_profiles' AND policyname = 'staff_profiles_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY staff_profiles_anon_select ON public.staff_profiles FOR SELECT TO anon USING (true)';
  END IF;
END $$;
