-- ============================================================
-- 0151_notifications_auth_tenant_scope.sql
--
-- CROSS-TENANT READ/WRITE HOLE on public.notifications.
--
-- The table carried:
--     notifications_auth_all  FOR ALL  TO authenticated
--       USING (true)  WITH CHECK (true)
--
-- Every Supabase-Auth user could therefore SELECT, UPDATE, DELETE and
-- INSERT any notification row belonging to ANY academy.
--
-- That set is not just owners. The public /join funnel signs a registrant in
-- with a phone OTP through Supabase Auth (see secure_submit_public_trial_v2,
-- which requires auth.uid()), so ANY member of the public who completes the
-- OTP on a registration form became `authenticated` — and could then read
-- every academy's notifications: parent names, fee amounts, "₹X for Y has
-- cleared", incoming trial leads. They could also delete them.
--
-- This is the exact pattern CLAUDE.md warns about — an untargeted FOR ALL
-- policy on this very table caused a shipped regression once before
-- (security-v3/12, fixed in 13). It came back.
--
-- FIX: scope `authenticated` to the caller's own academy with the existing
-- v3 helper, get_my_academy_id() — `SELECT academy_id FROM profiles WHERE
-- id = auth.uid()`. Owners have a profiles row, so they keep full access to
-- their own academy. Parents and /join registrants have none, so the helper
-- returns NULL, `academy_id = NULL` is never true, and they see nothing.
--
-- Academy-wide rather than own-rows-only is deliberate: fetchNoticeReceipts()
-- has an owner read OTHER recipients' rows by announcement_id to build the
-- read/confirm receipts for a notice they sent. Restricting to
-- recipient_id = auth.uid() would silently break that feature.
--
-- The four `anon` policies are correct already (staff and student portals
-- reach this table through x-staff-token / x-student-token headers, scoped by
-- current_staff_academy() / current_student_academy()) and are left alone.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS notifications_auth_all      ON public.notifications;
DROP POLICY IF EXISTS notifications_auth_select   ON public.notifications;
DROP POLICY IF EXISTS notifications_auth_insert   ON public.notifications;
DROP POLICY IF EXISTS notifications_auth_update   ON public.notifications;
DROP POLICY IF EXISTS notifications_auth_delete   ON public.notifications;

CREATE POLICY notifications_auth_select ON public.notifications
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

CREATE POLICY notifications_auth_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (academy_id = get_my_academy_id());

CREATE POLICY notifications_auth_update ON public.notifications
  FOR UPDATE TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

CREATE POLICY notifications_auth_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (academy_id = get_my_academy_id());

COMMIT;

-- ============================================================
-- Post-migration verification (both run inside a rolled-back txn):
-- ============================================================
--   -- a /join registrant / parent: an auth uid with no profiles row
--   BEGIN;
--     SET LOCAL role authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
--     SELECT count(*) FROM notifications;   -- expect 0
--   ROLLBACK;
--
--   -- a real owner sees their own academy and nothing else
--   BEGIN;
--     SET LOCAL role authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>"}';
--     SELECT count(DISTINCT academy_id) FROM notifications;  -- expect 1
--   ROLLBACK;
