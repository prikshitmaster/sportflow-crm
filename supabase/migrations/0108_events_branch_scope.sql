-- 0108 — branch-isolate events_anon_read (staff + student arms).
--
-- events gained branch_id in 0089 but the read policy (security-v3/09) still
-- only checked academy, so staff/student tokens could read every branch's
-- events. Mirrors the client filters (staffScopedEvents / StudentAnnouncements):
--   • branch_id NULL = academy-wide → visible to everyone in the academy
--   • branch-tagged  → staff: own branch only (NULL staff branch = office = all)
--                      student: own branch only
-- Sport + audience targeting stay client-side by design (branch is the DB
-- isolation boundary — see security-v3/14 rationale).
-- Owner (authenticated events_owner_all) unchanged.
--
-- Rollback: recreate with
--   USING (academy_id = current_staff_academy() OR academy_id = current_student_academy()).

BEGIN;

DROP POLICY IF EXISTS events_anon_read ON public.events;

CREATE POLICY events_anon_read ON public.events
  FOR SELECT TO anon
  USING (
    (
      academy_id = current_staff_academy()
      AND (branch_id IS NULL OR current_staff_branch() IS NULL OR branch_id = current_staff_branch())
    )
    OR (
      academy_id = current_student_academy()
      AND (
        branch_id IS NULL
        OR EXISTS (
          SELECT 1 FROM students s
          WHERE s.id = current_student_id()
            AND s.branch_id = events.branch_id
        )
      )
    )
  );

COMMIT;
