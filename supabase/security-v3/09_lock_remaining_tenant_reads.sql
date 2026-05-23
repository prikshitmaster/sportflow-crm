-- security-v3 / 09 — Phase 3.3b-2: lock remaining tenant tables
--
-- For each table: create a scoped *_anon_read policy and drop the
-- USING(true) shadow. Owner authenticated reads via _owner_all
-- continue to work unaffected.
--
-- Tables in this batch:
--   staff               → academy scope (both staff + students see)
--   events              → academy scope (both)
--   tournament_matches  → via events.academy_id
--   session_plans       → staff academy
--   session_phases      → via session_plans
--   sport_branches      → academy scope (both)
--   academy_branches    → academy scope (both)
--   trial_sources       → staff academy
--   activity_sessions   → academy scope
--   fee_plans           → academy scope (both)
--   skill_assessments   → staff academy OR own student_id
--   player_goals        → staff academy OR own student_id
--   drill_favorites     → academy scope (drill prefs are not sensitive)
--   drills              → is_global=true OR own academy
--   staff_attendance    → staff academy
--   leave_requests      → staff academy
--   student_batches     → academy scope (both)
--   payment_links       → token-gated (caller passes short_code)
--                         existing payment_links_select_anon stays — special case
--   staff_invites       → token-gated (invite/:token page) + owner authenticated
--   user_permissions    → academy scope
--
-- NOT in this batch:
--   students   → needs RPC for batchmate fetches, handled separately
--   gate_qr    → KEEP wide-open by design (gate scan must work pre-auth)
--   payments, batches, announcements, attendance, trials, staff_auth,
--   staff_profiles, staff_sessions, student_sessions — already done.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ═══ staff ═══════════════════════════════════════════════════════
DROP POLICY IF EXISTS staff_anon_read   ON public.staff;
CREATE POLICY staff_anon_read ON public.staff FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS staff_anon_select ON public.staff;

-- ═══ events ══════════════════════════════════════════════════════
DROP POLICY IF EXISTS events_anon_read   ON public.events;
CREATE POLICY events_anon_read ON public.events FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS events_anon_select ON public.events;

-- ═══ tournament_matches (via events) ════════════════════════════
DROP POLICY IF EXISTS tournament_matches_anon_read   ON public.tournament_matches;
CREATE POLICY tournament_matches_anon_read ON public.tournament_matches FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = tournament_matches.event_id
      AND (e.academy_id = current_staff_academy() OR e.academy_id = current_student_academy())
  ));
DROP POLICY IF EXISTS tournament_matches_anon_select ON public.tournament_matches;

-- ═══ session_plans (staff only) ═════════════════════════════════
DROP POLICY IF EXISTS session_plans_anon_read   ON public.session_plans;
CREATE POLICY session_plans_anon_read ON public.session_plans FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS session_plans_anon_select ON public.session_plans;

-- ═══ session_phases (via session_plans) ═════════════════════════
DROP POLICY IF EXISTS session_phases_anon_read   ON public.session_phases;
CREATE POLICY session_phases_anon_read ON public.session_phases FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM session_plans sp
    WHERE sp.id = session_phases.session_id
      AND sp.academy_id = current_staff_academy()
  ));
DROP POLICY IF EXISTS session_phases_anon_select ON public.session_phases;

-- ═══ sport_branches ══════════════════════════════════════════════
DROP POLICY IF EXISTS sport_branches_anon_read   ON public.sport_branches;
CREATE POLICY sport_branches_anon_read ON public.sport_branches FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS sport_branches_anon_select ON public.sport_branches;

-- ═══ academy_branches ═══════════════════════════════════════════
DROP POLICY IF EXISTS academy_branches_anon_read   ON public.academy_branches;
CREATE POLICY academy_branches_anon_read ON public.academy_branches FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS academy_branches_anon_select ON public.academy_branches;

-- ═══ trial_sources (staff only) ═════════════════════════════════
DROP POLICY IF EXISTS trial_sources_anon_read   ON public.trial_sources;
CREATE POLICY trial_sources_anon_read ON public.trial_sources FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS trial_sources_anon_select ON public.trial_sources;

-- ═══ activity_sessions ══════════════════════════════════════════
DROP POLICY IF EXISTS activity_sessions_anon_read   ON public.activity_sessions;
CREATE POLICY activity_sessions_anon_read ON public.activity_sessions FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS activity_sessions_anon_select ON public.activity_sessions;

-- ═══ fee_plans ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS fee_plans_anon_read   ON public.fee_plans;
CREATE POLICY fee_plans_anon_read ON public.fee_plans FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS fee_plans_anon_select ON public.fee_plans;

-- ═══ skill_assessments ══════════════════════════════════════════
DROP POLICY IF EXISTS skill_assessments_anon_read   ON public.skill_assessments;
CREATE POLICY skill_assessments_anon_read ON public.skill_assessments FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR student_id = current_student_id());
DROP POLICY IF EXISTS skill_assessments_anon_select ON public.skill_assessments;

-- ═══ player_goals ════════════════════════════════════════════════
DROP POLICY IF EXISTS player_goals_anon_read   ON public.player_goals;
CREATE POLICY player_goals_anon_read ON public.player_goals FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR student_id = current_student_id());
DROP POLICY IF EXISTS player_goals_anon_select ON public.player_goals;

-- ═══ drill_favorites ════════════════════════════════════════════
DROP POLICY IF EXISTS drill_favorites_anon_read   ON public.drill_favorites;
CREATE POLICY drill_favorites_anon_read ON public.drill_favorites FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS drill_favorites_anon_select ON public.drill_favorites;

-- ═══ drills (global + own academy) ══════════════════════════════
DROP POLICY IF EXISTS drills_anon_read   ON public.drills;
CREATE POLICY drills_anon_read ON public.drills FOR SELECT TO anon
  USING (
    is_global = true
    OR academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );
DROP POLICY IF EXISTS drills_anon_select ON public.drills;

-- ═══ staff_attendance ═══════════════════════════════════════════
DROP POLICY IF EXISTS staff_attendance_anon_read   ON public.staff_attendance;
CREATE POLICY staff_attendance_anon_read ON public.staff_attendance FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS staff_attendance_anon_select ON public.staff_attendance;

-- ═══ leave_requests ═════════════════════════════════════════════
DROP POLICY IF EXISTS leave_requests_anon_read   ON public.leave_requests;
CREATE POLICY leave_requests_anon_read ON public.leave_requests FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS leave_requests_anon_select ON public.leave_requests;

-- ═══ student_batches ════════════════════════════════════════════
DROP POLICY IF EXISTS student_batches_anon_read   ON public.student_batches;
CREATE POLICY student_batches_anon_read ON public.student_batches FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
DROP POLICY IF EXISTS student_batches_anon_select ON public.student_batches;

-- ═══ staff_invites (token-gated SELECT + drop wide shadow) ══════
-- /invite/:token page reads by token. Scope to "your token matches"
-- so an attacker can't list every invite in the academy.
DROP POLICY IF EXISTS staff_invites_anon_read   ON public.staff_invites;
CREATE POLICY staff_invites_anon_read ON public.staff_invites FOR SELECT TO anon
  USING (
    -- token-based: caller must know the exact token to read its row
    token = current_setting('request.headers', true)::json->>'x-invite-token'
    -- staff session header: an owner-ish read path (covered by owner_all too)
    OR academy_id = current_staff_academy()
  );
DROP POLICY IF EXISTS staff_invites_anon_select ON public.staff_invites;

-- ═══ user_permissions ═══════════════════════════════════════════
DROP POLICY IF EXISTS user_permissions_anon_read   ON public.user_permissions;
CREATE POLICY user_permissions_anon_read ON public.user_permissions FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
DROP POLICY IF EXISTS user_permissions_anon_select ON public.user_permissions;

-- payment_links has its own scoped policy already (payment_links_select_anon
-- uses ?short_code=...). Leave it alone.

-- gate_qr stays wide-open by design — the gate device scans publicly,
-- and the token itself is the credential (validated server-side).

COMMIT;
