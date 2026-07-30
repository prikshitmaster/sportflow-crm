-- 0121: Restore INSERT/UPDATE policies on academies — signup is currently broken.
--
-- security-v3/12 dropped the old permissive `open_access` policy on academies
-- (which covered ALL operations) and replaced it with SELECT-only policies,
-- on the assumption that "writes are owner-only via secure_update_academy /
-- etc. (RPCs bypass RLS)" (see its comment). That RPC was never actually
-- built — src/lib/db.js still does raw client-side writes:
--   createAcademy()        → supabase.from('academies').insert(...)   (owner signup)
--   updateAcademyLogoUrl() → supabase.from('academies').update(...)
-- With no INSERT/UPDATE policy left on the table, every new-academy signup
-- has been failing with "new row violates row-level security policy for
-- table academies" since #12 was applied — this blocks ALL new signups.
--
-- Restores the original scoping from schema_rls.sql: an authenticated user
-- may only create an academy row naming themselves as owner, and may only
-- update an academy they already own. Same shape as the pre-lockdown policy,
-- just re-added under the security-v3 naming so it isn't dropped again.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

DROP POLICY IF EXISTS academies_owner_insert ON public.academies;
CREATE POLICY academies_owner_insert ON public.academies FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS academies_owner_update ON public.academies;
CREATE POLICY academies_owner_update ON public.academies FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

COMMIT;
