-- 0087: Restore audit logging for staff / branch managers / students.
--
-- The security hardening left audit_logs with an INSERT policy for the
-- `authenticated` role (owner) only — there was NO INSERT policy for `anon`.
-- Staff, branch managers, and students all act under the `anon` role (with a
-- session-token header), so every audit insert they attempted was silently
-- rejected by RLS. Result: only owner actions were ever logged; a branch
-- manager adding a student / recording a payment produced no audit row.
--
-- Fix: a scoped anon INSERT policy. audit_logs has no UPDATE/DELETE policy for
-- anyone, so it stays tamper-proof (append-only). Rows are still confined to
-- the actor's own academy (resolved from the session token), matching the
-- existing anon SELECT policy.

GRANT INSERT ON public.audit_logs TO anon;

DROP POLICY IF EXISTS audit_logs_anon_insert ON public.audit_logs;
CREATE POLICY audit_logs_anon_insert ON public.audit_logs FOR INSERT TO anon
  WITH CHECK (
    academy_id IS NULL
    OR academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );
