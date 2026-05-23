-- security-v3 / Phase 4-C (3/4) — branch-isolate payments_anon_read
--
-- payments has no branch_id/sport of its own, so staff branch scope is applied
-- through the student: a staff token sees a payment only if its student is in
-- the staff's branch. NULL branch (office/multi) bypasses → all academy payments.
-- Mirrors the students branch-only choice; the client further narrows by sport
-- via the student set, so the DB returns a superset (no UI rows lost).
--
-- PRESERVED: student-self clause (student_id = current_student_id()) so a student
-- still sees their own payments. Owners use payments_owner_all (authenticated);
-- parents read via secure_get_parent_dashboard (SECURITY DEFINER, bypasses RLS).
--
-- Well-indexed: idx_payments_academy_student + idx_students_academy_branch.
-- Rollback: recreate with
--   USING ((academy_id = current_staff_academy()) OR (student_id = current_student_id())).

BEGIN;

DROP POLICY IF EXISTS payments_anon_read ON public.payments;

CREATE POLICY payments_anon_read ON public.payments
  FOR SELECT TO anon
  USING (
    (
      academy_id = current_staff_academy()
      AND (
        current_staff_branch() IS NULL
        OR student_id IN (
          SELECT id FROM students
          WHERE academy_id = current_staff_academy()
            AND branch_id = current_staff_branch()
        )
      )
    )
    OR student_id = current_student_id()
  );

COMMIT;
