-- 0134 — Fix payments_anon_read to let branch-scoped staff see trial-fee rows
--
-- security-v3/16_branch_pilot_payments.sql branch-scoped this policy through
-- the STUDENT ("payments has no branch_id/sport of its own"), which was true
-- at the time. Migration 0124 (trial-fee-as-its-own-payments-row) later added
-- branch_id/sport DIRECTLY on payments for trial-fee rows, which have no
-- student_id until conversion — but 16's policy was never updated for that,
-- so a trial-fee row (student_id IS NULL) never matched the branch-scoped
-- staff clause and was silently invisible to ANY staff member with a branch
-- assigned. Not a client bug: the client-side scoping in AppContext.jsx
-- already correctly self-scopes these rows via their own branch_id/sport —
-- the rows just never reached the client because RLS excluded them first.
--
-- Symptom: a branch manager/coach sees ₹0 collected for a month where trial
-- fees were genuinely paid (Cash/UPI) and the payments row demonstrably
-- exists with status='Paid'. Owners were unaffected (payments_owner_all has
-- no student_id restriction at all).
--
-- Fix: add one more OR-clause — a NULL-student row is visible if ITS OWN
-- branch_id matches the staff's branch. Office/multi-branch staff (branch
-- IS NULL) and the student-self clause are unchanged. Does not widen
-- cross-branch visibility: the added clause still requires an exact
-- branch_id match, same as the existing student-linked clause.
--
-- IDEMPOTENT.

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
        OR (student_id IS NULL AND branch_id = current_staff_branch())
      )
    )
    OR student_id = current_student_id()
  );

COMMIT;
