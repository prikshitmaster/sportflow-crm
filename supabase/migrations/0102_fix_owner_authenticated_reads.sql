-- ============================================================
-- 0102 — Restore owner (authenticated) access to session/coach data
-- ============================================================
-- WHY
--   security-v3/10_drop_legacy_open_shadows.sql dropped the old
--   USING(true) policies on these tables (which applied to every role,
--   including `authenticated`). The replacement policies added in
--   security-v3/09 and migration 0054 only grant SELECT `TO anon` —
--   the role used by the staff/student custom-login path. No policy
--   was ever added back for `TO authenticated` (the owner's real
--   Supabase Auth session), so since that migration ran the owner has
--   had zero access — read or write — to session_plans, session_phases,
--   player_goals, drill_favorites, trial_sources, and activity_sessions.
--   Symptom: owner's Sessions calendar always shows 0 sessions / no
--   history, even though coaches can create and complete sessions.
--
-- FIX
--   Add an owner-scoped `FOR ALL TO authenticated` policy per table,
--   matching the existing pattern (schema_rls.sql) of
--   `academy_id = get_my_academy_id()` used for students/batches/staff/etc.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── session_plans ────────────────────────────────────────────
DROP POLICY IF EXISTS session_plans_auth_all ON public.session_plans;
CREATE POLICY session_plans_auth_all ON public.session_plans FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── session_phases (scoped via parent session_plans) ─────────
DROP POLICY IF EXISTS session_phases_auth_all ON public.session_phases;
CREATE POLICY session_phases_auth_all ON public.session_phases FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM session_plans sp
    WHERE sp.id = session_phases.session_id
      AND sp.academy_id = get_my_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM session_plans sp
    WHERE sp.id = session_phases.session_id
      AND sp.academy_id = get_my_academy_id()
  ));

-- ── player_goals ──────────────────────────────────────────────
DROP POLICY IF EXISTS player_goals_auth_all ON public.player_goals;
CREATE POLICY player_goals_auth_all ON public.player_goals FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── drill_favorites ───────────────────────────────────────────
DROP POLICY IF EXISTS drill_favorites_auth_all ON public.drill_favorites;
CREATE POLICY drill_favorites_auth_all ON public.drill_favorites FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── trial_sources ─────────────────────────────────────────────
DROP POLICY IF EXISTS trial_sources_auth_all ON public.trial_sources;
CREATE POLICY trial_sources_auth_all ON public.trial_sources FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── activity_sessions ─────────────────────────────────────────
DROP POLICY IF EXISTS activity_sessions_auth_all ON public.activity_sessions;
CREATE POLICY activity_sessions_auth_all ON public.activity_sessions FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

COMMIT;
