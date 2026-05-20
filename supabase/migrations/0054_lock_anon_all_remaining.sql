-- ============================================================
-- 0054 — Phase 11b: lock anon write on all remaining tables
-- ============================================================
-- WHY
--   Phase 11a (migration 0053) added SECURITY DEFINER RPCs for all
--   remaining write paths. Raw anon_all policies on these tables are
--   now redundant and allow unauthenticated forgery.
--
-- TABLES LOCKED
--   gate_qr, sport_branches, academy_branches,
--   events, tournament_matches, staff_invites,
--   leave_requests, staff_attendance,
--   skill_assessments, player_goals,
--   drills, drill_favorites,
--   session_plans, session_phases, activity_sessions
--
-- NOT TOUCHED
--   staff_sessions / student_sessions — INSERT still needed for login flow.
--
-- WRITE SURFACE AFTER THIS MIGRATION
--   All writes on the above tables → SECURITY DEFINER RPCs (migration 0053).
--   SELECT → wide-open anon_select policy on all tables.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── Drop raw anon_all write policies ────────────────────────

DROP POLICY IF EXISTS gate_qr_anon_all           ON public.gate_qr;
DROP POLICY IF EXISTS sport_branches_anon_all    ON public.sport_branches;
DROP POLICY IF EXISTS academy_branches_anon_all  ON public.academy_branches;
DROP POLICY IF EXISTS events_anon_all            ON public.events;
DROP POLICY IF EXISTS tournament_matches_anon_all ON public.tournament_matches;
DROP POLICY IF EXISTS staff_invites_anon_all     ON public.staff_invites;
DROP POLICY IF EXISTS leave_requests_anon_all    ON public.leave_requests;
DROP POLICY IF EXISTS staff_attendance_anon_all  ON public.staff_attendance;
DROP POLICY IF EXISTS skill_assessments_anon_all ON public.skill_assessments;
DROP POLICY IF EXISTS player_goals_anon_all      ON public.player_goals;
DROP POLICY IF EXISTS drills_anon_all            ON public.drills;
DROP POLICY IF EXISTS drill_favorites_anon_all   ON public.drill_favorites;
DROP POLICY IF EXISTS session_plans_anon_all     ON public.session_plans;
DROP POLICY IF EXISTS session_phases_anon_all    ON public.session_phases;
DROP POLICY IF EXISTS activity_sessions_anon_all ON public.activity_sessions;

-- ── Ensure SELECT-only anon policies exist ───────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'gate_qr',
    'sport_branches',
    'academy_branches',
    'events',
    'tournament_matches',
    'staff_invites',
    'leave_requests',
    'staff_attendance',
    'skill_assessments',
    'player_goals',
    'drills',
    'drill_favorites',
    'session_plans',
    'session_phases',
    'activity_sessions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = tbl
        AND policyname = tbl || '_anon_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
        tbl || '_anon_select', tbl
      );
    END IF;
  END LOOP;
END $$;
