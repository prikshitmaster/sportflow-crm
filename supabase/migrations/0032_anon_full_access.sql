-- ============================================================
-- 0032 — Final comprehensive anon role access
-- ============================================================
-- BACKGROUND
--   Coaches/staff use the anon key + custom session headers.
--   Previous migrations only opened SELECT for anon on most tables,
--   leaving INSERT/UPDATE/DELETE silently blocked for:
--     payments, batches, trials, announcements, assessments,
--     audit_logs, drills, fee_plans, events, leave_requests,
--     student_batches, gate_qr, feature_flags, and more.
--   This migration gives the anon role unrestricted ALL access
--   to every application data table — matching the wide-open
--   approach already used in 0019d for SELECT.
--
-- WHAT IS NOT TOUCHED
--   • academies, profiles — owner-only, authenticated path
--   • staff_auth, staff_sessions, staff_profiles,
--     student_sessions — already have anon_full policies from 0019d
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DO $$
DECLARE
  app_tables text[] := ARRAY[
    'students','batches','payments','attendance','trials','announcements',
    'staff','gate_qr','audit_logs','student_batches',
    'skill_assessments','drill_favorites','drills',
    'feature_flags','fee_plans','events','leave_requests',
    'notifications','push_subscriptions',
    'session_plans','session_phases','session_feedback','activity_sessions',
    'sport_branches','academy_branches','staff_attendance',
    'player_goals','trial_sources','tournament_matches',
    'user_permissions','staff_invites'
  ];
  t    text;
  pol  text;
BEGIN
  FOREACH t IN ARRAY app_tables LOOP
    -- Skip tables that don't exist yet (future migrations will add them)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'skip % — table does not exist', t;
      CONTINUE;
    END IF;

    -- Drop any existing anon_* policies on this table so there are no conflicts
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND (policyname LIKE '%anon%' OR policyname LIKE '%open_access%')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;

    -- Ensure RLS is enabled
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Create a single catch-all anon policy
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
      t || '_anon_all', t
    );

    RAISE NOTICE 'anon_all policy applied to %', t;
  END LOOP;
END $$;

-- Also ensure the auth helper tables keep their existing full-access policies
-- (0019d already created these; this is belt-and-braces in case they were lost)
DO $$
DECLARE
  auth_tables text[] := ARRAY['staff_auth','staff_sessions','staff_profiles','student_sessions'];
  t text;
BEGIN
  FOREACH t IN ARRAY auth_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_full', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t || '_anon_full', t
    );
  END LOOP;
END $$;
