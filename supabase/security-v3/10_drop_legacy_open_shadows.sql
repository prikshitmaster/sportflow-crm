-- security-v3 / 10 — Drop the legacy USING(true) policies that are
-- shadowing the scoped policies created in 07/08/09.
--
-- These predate the *_anon_select naming convention but do the same
-- thing: grant unrestricted access. PostgreSQL policies are permissive
-- (ANY matching policy grants access), so as long as these exist the
-- scoped policies are useless.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- session_plans / session_phases: PUBLIC ALL+SELECT USING(true) — wipe out
DROP POLICY IF EXISTS session_plans_read   ON public.session_plans;
DROP POLICY IF EXISTS session_plans_write  ON public.session_plans;
DROP POLICY IF EXISTS session_plans_all    ON public.session_plans;
DROP POLICY IF EXISTS session_phases_read  ON public.session_phases;
DROP POLICY IF EXISTS session_phases_write ON public.session_phases;
DROP POLICY IF EXISTS session_phases_all   ON public.session_phases;

-- player_goals: PUBLIC ALL USING(true)
DROP POLICY IF EXISTS player_goals_all     ON public.player_goals;

-- drill_favorites: PUBLIC ALL USING(true)
DROP POLICY IF EXISTS drill_favorites_all  ON public.drill_favorites;

-- trial_sources: PUBLIC ALL USING(true) named "open"
DROP POLICY IF EXISTS "open"               ON public.trial_sources;

-- activity_sessions: PUBLIC ALL USING(true) named "ops_open"
DROP POLICY IF EXISTS ops_open             ON public.activity_sessions;

COMMIT;
