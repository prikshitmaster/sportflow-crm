-- security-v3 / Phase 4-C (1/4) — branch-isolate students_anon_read
--
-- Staff now only SELECT students in their own branch (NULL branch = office/
-- multi-branch = all branches). The student-self clause is PRESERVED so a
-- logged-in student still reads their own row.
--
-- BRANCH-ONLY by design (NOT sport): the client scopes students by branch
-- (hard) and then batch-OR-sport within the branch. A DB sport predicate would
-- hide students who are in a coach's batch but carry a different/empty sport,
-- diverging from the UI. So sport stays a client-side filter; branch is the DB
-- isolation boundary. The DB returns the branch superset; the client narrows.
--
-- Owners (authenticated → students_owner_all) and parents (RPC
-- secure_get_parent_dashboard, SECURITY DEFINER) are unaffected.
--
-- Rollback: recreate with USING ((academy_id = current_staff_academy()) OR (id = current_student_id())).

BEGIN;

DROP POLICY IF EXISTS students_anon_read ON public.students;

CREATE POLICY students_anon_read ON public.students
  FOR SELECT TO anon
  USING (
    (
      academy_id = current_staff_academy()
      AND (current_staff_branch() IS NULL OR branch_id = current_staff_branch())
    )
    OR id = current_student_id()
  );

COMMIT;
