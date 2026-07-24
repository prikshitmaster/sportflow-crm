-- 0110 — branch-isolate staff_attendance and leave_requests reads.
--
-- Both were academy-wide for any staff token (security-v3/09). Now a
-- branch-locked staff token reads only rows belonging to staff of their own
-- branch (or branch-less staff, who count as academy-level). Office /
-- multi-branch staff (NULL branch) keep the academy view. Own rows always
-- remain visible because a staff member is in their own branch.
-- Owner (authenticated) policies unchanged; the QR clock-in INSERT path is
-- untouched.
--
-- Rollback: recreate both with USING (academy_id = current_staff_academy()).

BEGIN;

DROP POLICY IF EXISTS staff_attendance_anon_read ON public.staff_attendance;
CREATE POLICY staff_attendance_anon_read ON public.staff_attendance
  FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    AND (
      current_staff_branch() IS NULL
      OR EXISTS (
        SELECT 1 FROM staff st
        WHERE st.id = staff_attendance.staff_id
          AND (st.branch_id IS NULL OR st.branch_id = current_staff_branch())
      )
    )
  );

DROP POLICY IF EXISTS leave_requests_anon_read ON public.leave_requests;
CREATE POLICY leave_requests_anon_read ON public.leave_requests
  FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    AND (
      current_staff_branch() IS NULL
      OR EXISTS (
        SELECT 1 FROM staff st
        WHERE st.id = leave_requests.staff_id
          AND (st.branch_id IS NULL OR st.branch_id = current_staff_branch())
      )
    )
  );

COMMIT;
