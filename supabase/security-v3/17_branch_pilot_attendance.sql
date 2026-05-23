-- security-v3 / Phase 4-C (4/4) — branch-isolate attendance_anon_read
--
-- attendance already scopes via EXISTS-on-students (staff academy OR student-self).
-- We add the branch check to the staff arm only: a staff token sees an attendance
-- row only if its student is in the staff's branch (NULL branch = office = all).
-- Student-self arm (s.id = current_student_id()) is preserved unchanged.
--
-- Branch-only (matches students/payments). Owners use attendance_owner_all.
-- Rollback: recreate with the staff arm = (s.academy_id = current_staff_academy()).

BEGIN;

DROP POLICY IF EXISTS attendance_anon_read ON public.attendance;

CREATE POLICY attendance_anon_read ON public.attendance
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = attendance.student_id
        AND (
          (
            s.academy_id = current_staff_academy()
            AND (current_staff_branch() IS NULL OR s.branch_id = current_staff_branch())
          )
          OR s.id = current_student_id()
        )
    )
  );

COMMIT;
