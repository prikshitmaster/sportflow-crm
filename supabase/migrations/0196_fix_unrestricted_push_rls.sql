-- 0196: fix two real, severe cross-tenant RLS gaps found while auditing
-- notification isolation, unrelated to anything else this session.
--
-- push_subscriptions_auth_all and fcm_tokens_auth_all were both
-- `FOR ALL TO authenticated USING (true) WITH CHECK (true)` — completely
-- unrestricted for ANY authenticated Supabase Auth user (i.e. any owner
-- account on the ENTIRE platform, any academy). Any owner could read,
-- insert, update, or delete any OTHER academy's push/FCM device
-- registrations — including silently inserting their own device against a
-- foreign academy_id to intercept that academy's web-push/Android push
-- notifications going forward.
--
-- push_subscriptions_auth_all was created this way in
-- security-v3/13_fix_notifications_write_policies.sql (2026-07-27),
-- explicitly modeled on an "announcements_auth_all pattern" per that
-- migration's own comment — restoring functionality after an earlier
-- regression, but never actually academy-scoped. fcm_tokens_auth_all
-- appears to have never been scoped at all. Both tables already have
-- academy_id; the sibling `notifications_auth_*` policies on the
-- `notifications` table already use the correct pattern
-- (`academy_id = get_my_academy_id()`) — applying the same here.

DROP POLICY IF EXISTS push_subscriptions_auth_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_auth_all ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

DROP POLICY IF EXISTS fcm_tokens_auth_all ON public.fcm_tokens;
CREATE POLICY fcm_tokens_auth_all ON public.fcm_tokens
  FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());
