-- ============================================================
-- 0119 — Owner (authenticated) reads on the performance tables
-- ============================================================
-- SYMPTOM
--   The owner's /performance page showed "Not assessed" for every student even
--   though the branch had 3,000+ skill_assessments rows. Reports → Performance
--   was empty for the same reason. The coach's Staff → Player Performance
--   showed the identical data correctly.
--
-- CAUSE
--   These tables have RLS enabled but only an `anon` policy:
--
--     skill_assessments : skill_assessments_anon_read  SELECT  {anon}
--     session_feedback  : session_feedback_anon_read   SELECT  {anon}
--     student_batches   : student_batches_anon_read    SELECT  {anon}
--     staff_attendance  : staff_attendance_anon_read   SELECT  {anon}
--     student_badges    : student_badges_anon_read     SELECT  {anon}
--
--   Coaches and students reach Postgres as `anon` (their session token is
--   resolved inside current_staff_academy() / current_student_id()), so they
--   match. The OWNER authenticates with a Supabase JWT and therefore arrives as
--   `authenticated` — a role with no policy at all on these tables. With RLS on
--   and no matching policy, every SELECT returns zero rows. Silently: no error,
--   just an empty result, which the UI honestly renders as "not assessed".
--
--   migration 0102_fix_owner_authenticated_reads.sql fixed exactly this class
--   of bug for session_plans, session_phases, player_goals, drill_favorites,
--   trial_sources and activity_sessions. These five were missed. That is also
--   why the development plan worked for the owner while the assessment beside
--   it did not — player_goals was in 0102's list, skill_assessments was not.
--
--   (`drills` looked affected too but is fine: its drills_read/drills_write
--    policies are TO public, which covers every role including authenticated.)
--
-- FIX
--   Add the same academy-scoped authenticated policy 0102 used, via
--   get_my_academy_id(). Owner access stays confined to their own academy —
--   this widens the role, never the tenant boundary. Branch isolation is
--   unaffected: it is enforced client-side plus by _require_branch_scope on
--   writes, exactly as before.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- student_batches predates the academy_id column; 8 legacy rows still have it
-- NULL and would be invisible under an academy-scoped policy. Backfill from the
-- student, same approach migration 0031 used for other legacy rows.
UPDATE student_batches sb
   SET academy_id = s.academy_id
  FROM students s
 WHERE s.id = sb.student_id
   AND sb.academy_id IS NULL
   AND s.academy_id IS NOT NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'skill_assessments',
    'session_feedback',
    'student_batches',
    'staff_attendance',
    'student_badges'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '%: table not present — skipped', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_auth_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (academy_id = get_my_academy_id())
         WITH CHECK (academy_id = get_my_academy_id())',
      t || '_auth_all', t);

    RAISE NOTICE '%: authenticated policy added', t;
  END LOOP;
END $$;

COMMIT;

-- Verify — each table should now list an *_auth_all policy for {authenticated}
-- alongside its existing {anon} one:
--   SELECT tablename, policyname, cmd, roles::text
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('skill_assessments','session_feedback','student_batches',
--                        'staff_attendance','student_badges')
--    ORDER BY tablename, policyname;
