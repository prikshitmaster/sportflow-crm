-- Firebase Cloud Messaging device tokens (native Android push delivery channel).
-- Scoping mirrors push_subscriptions after security-v3/13_fix_notifications_write_policies.sql:
-- anon (staff/student portals) scoped to their own academy via current_staff_academy() /
-- current_student_academy(); authenticated (owner) gets full access, app layer sets academy_id.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id          bigint generated always as identity primary key,
  user_type   text   not null check (user_type in ('owner','staff','student')),
  user_id     text   not null,
  academy_id  uuid   references public.academies(id) on delete cascade not null,
  token       text   not null unique,
  platform    text   not null default 'android',
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS fcm_tokens_user_idx
  ON public.fcm_tokens (user_id, user_type, academy_id);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fcm_tokens_anon_select ON public.fcm_tokens;
DROP POLICY IF EXISTS fcm_tokens_anon_insert ON public.fcm_tokens;
DROP POLICY IF EXISTS fcm_tokens_anon_update ON public.fcm_tokens;
DROP POLICY IF EXISTS fcm_tokens_anon_delete ON public.fcm_tokens;
DROP POLICY IF EXISTS fcm_tokens_auth_all    ON public.fcm_tokens;

CREATE POLICY fcm_tokens_anon_select ON public.fcm_tokens FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY fcm_tokens_anon_insert ON public.fcm_tokens FOR INSERT TO anon
  WITH CHECK (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY fcm_tokens_anon_update ON public.fcm_tokens FOR UPDATE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY fcm_tokens_anon_delete ON public.fcm_tokens FOR DELETE TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

CREATE POLICY fcm_tokens_auth_all ON public.fcm_tokens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;
