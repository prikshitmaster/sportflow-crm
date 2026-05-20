-- ============================================================
-- 0048 — Phase 8b: lock anon write on user_permissions
-- ============================================================
-- WHY
--   Phase 8a (migration 0047) covers all 3 write paths via SECURITY DEFINER
--   RPCs. The user_permissions_anon_all policy (from 0032) is the last
--   privilege-escalation hole: any anon caller can INSERT { user_id, access_role: 'owner' }.
--   This migration closes it.
--
-- USER_PERMISSIONS WRITE SURFACE AFTER THIS MIGRATION
--   invite signup    → secure_complete_invite_signup (authenticated, invite token)
--   edit role/perms  → secure_update_user_permissions (owner only)
--   revoke access    → secure_revoke_user_permissions (owner only)
--   SELECT           → user_permissions_anon_select (wide-open, intentional)
--   INSERT/UPDATE/DELETE → all locked (RPC-only via SECURITY DEFINER)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS user_permissions_anon_all ON public.user_permissions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_permissions'
      AND policyname = 'user_permissions_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY user_permissions_anon_select ON public.user_permissions FOR SELECT TO anon, authenticated USING (true)';
  END IF;
END $$;
