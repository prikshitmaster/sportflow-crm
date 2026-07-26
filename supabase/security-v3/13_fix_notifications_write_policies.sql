-- security-v3 / 13 — fix: restore writes on notifications + push_subscriptions
--
-- Regression introduced by 12_lock_final_stragglers.sql. That file's original
-- policies (migration 0028) were `FOR ALL` with no `TO` clause, which in
-- Postgres defaults to PUBLIC — i.e. they covered both anon (staff/student
-- portals) AND authenticated (owner) requests. #12 dropped those and added
-- back SELECT-only, TO anon. Net effect, on both tables:
--   - anon (staff/student)  lost INSERT/UPDATE/DELETE — notify(), markRead(),
--     markAllRead(), deleteNotification(), savePushSubscription() all started
--     silently failing (client code uses Promise.allSettled / swallows errors).
--   - authenticated (owner) lost ALL access, including SELECT — the owner's
--     own NotificationBell has been reading zero rows since #12 applied.
--
-- Compare to how #12 handled `academies` in the same file: that table got
-- both an anon_read AND an `academies_owner_read ... TO authenticated`
-- policy. notifications/push_subscriptions only got the anon half — this
-- file adds the missing other half plus the anon write policies.
--
-- Scoping matches the anon_read policy already live on both tables
-- (academy-level, not per-recipient — consistent with what's already
-- shipped, not a new gap). Owner gets the same `USING(true) WITH CHECK(true)`
-- authenticated-role pattern already used for `announcements_auth_all`
-- elsewhere in this schema (app layer always sets/filters academy_id on
-- these calls).
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ═══ notifications ═══════════════════════════════════════════════
DROP POLICY IF EXISTS notifications_anon_insert  ON public.notifications;
DROP POLICY IF EXISTS notifications_anon_update  ON public.notifications;
DROP POLICY IF EXISTS notifications_anon_delete  ON public.notifications;
DROP POLICY IF EXISTS notifications_auth_all     ON public.notifications;

CREATE POLICY notifications_anon_insert ON public.notifications FOR INSERT TO anon
  WITH CHECK (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY notifications_anon_update ON public.notifications FOR UPDATE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY notifications_anon_delete ON public.notifications FOR DELETE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY notifications_auth_all ON public.notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ═══ push_subscriptions ══════════════════════════════════════════
DROP POLICY IF EXISTS push_subscriptions_anon_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_anon_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_anon_delete ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_auth_all    ON public.push_subscriptions;

CREATE POLICY push_subscriptions_anon_insert ON public.push_subscriptions FOR INSERT TO anon
  WITH CHECK (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY push_subscriptions_anon_update ON public.push_subscriptions FOR UPDATE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY push_subscriptions_anon_delete ON public.push_subscriptions FOR DELETE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY push_subscriptions_auth_all ON public.push_subscriptions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;
