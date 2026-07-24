-- 0109 — harden ops telemetry reads (/ops/live data sources).
--
-- 1. activity_sessions: drop the student arm (security-v3/09 allowed any
--    student token to read the whole academy's live-activity telemetry).
--    Staff arm stays academy-scoped — the ops dashboard is used under an
--    owner or trusted-staff session.
-- 2. audit_logs: branch-scope the staff arm. Branch-locked staff now read
--    only their own branch's entries plus untagged (academy-level) rows;
--    office/multi-branch staff (NULL branch) and owners see everything.
--
-- Rollback:
--   activity_sessions → re-run security-v3/09 block (staff OR student academy)
--   audit_logs        → re-run security-v3/12_lock_final_stragglers block.

BEGIN;

DROP POLICY IF EXISTS activity_sessions_anon_read ON public.activity_sessions;
CREATE POLICY activity_sessions_anon_read ON public.activity_sessions
  FOR SELECT TO anon
  USING (academy_id = current_staff_academy());

DROP POLICY IF EXISTS audit_logs_anon_read ON public.audit_logs;
CREATE POLICY audit_logs_anon_read ON public.audit_logs
  FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    AND (
      current_staff_branch() IS NULL
      OR branch_id IS NULL
      OR branch_id = current_staff_branch()
    )
  );

COMMIT;
