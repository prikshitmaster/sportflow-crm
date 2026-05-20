-- ============================================================
-- 0046 — Phase 7b: lock anon INSERT on staff + staff_auth
-- ============================================================
-- WHY
--   Phase 7a (migration 0045) added secure_insert_staff (SECURITY DEFINER)
--   covering the full insertStaff path. The remaining raw INSERT policies
--   are now redundant and exploitable:
--
--   staff:      staff_anon_insert  (kept from 0034 for insertStaff)
--   staff_auth: staff_auth_anon_insert (kept from 0042 for insertStaff)
--
-- STAFF WRITE SURFACE AFTER THIS MIGRATION
--   INSERT new staff    → secure_insert_staff (owner-only)
--   permissions edit    → secure_update_staff_permissions (owner-only)
--   account activation  → secure_activate_staff_account
--   profile update      → secure_update_staff_profile
--   SELECT              → staff_anon_select (wide-open, intentional)
--   INSERT/UPDATE/DELETE → all locked (RPC-only via SECURITY DEFINER)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS staff_anon_insert      ON public.staff;
DROP POLICY IF EXISTS staff_auth_anon_insert ON public.staff_auth;

-- Sanity: SELECT policies should remain. Recreate if somehow missing.
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
      AND tablename = 'staff_auth' AND policyname = 'staff_auth_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY staff_auth_anon_select ON public.staff_auth FOR SELECT TO anon USING (true)';
  END IF;
END $$;
