-- security-v3 / 08 — Phase 3.3b-1: lock attendance + trials
--
-- These two tables only had the wide-open USING(true) anon SELECT policy.
-- No scoped policy existed alongside, so I have to create one before
-- dropping the shadow.
--
-- attendance scope:
--   Staff (with x-staff-token):  see all attendance for students in their academy
--   Student (with x-student-token): see only their own attendance rows
--   Both via JOIN to students for academy/own-row matching.
--
-- trials scope:
--   Staff (with x-staff-token): see all trials in their academy
--   Students: trials are pre-enrollment prospects, students don't see them.
--
-- Owner authenticated reads via _owner_all continue to work.
-- Write paths (all RPCs) unaffected — SECURITY DEFINER bypasses RLS.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- attendance
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS attendance_anon_read   ON public.attendance;
CREATE POLICY attendance_anon_read
  ON public.attendance FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = attendance.student_id
        AND (
          s.academy_id = current_staff_academy()
          OR s.id      = current_student_id()
        )
    )
  );

DROP POLICY IF EXISTS attendance_anon_select ON public.attendance;

-- ════════════════════════════════════════════════════════════════
-- trials
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS trials_anon_read   ON public.trials;
CREATE POLICY trials_anon_read
  ON public.trials FOR SELECT TO anon
  USING (academy_id = current_staff_academy());

DROP POLICY IF EXISTS trials_anon_select ON public.trials;

COMMIT;
