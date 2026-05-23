-- security-v3 / Phase 4-D — branch+sport-isolate announcements_anon_read (staff arm)
--
-- Unlike students/trials, a NULL branch_id here means ACADEMY-WIDE broadcast →
-- visible to everyone. Only branch-specific announcements are scoped to a staff
-- member's branch; only sport-specific ones to their sport. Mirrors the client
-- staffScopedAnnouncements filter exactly.
--
-- PRESERVED: the student arm (academy_id = current_student_academy()) — student
-- announcement visibility is unchanged. Owners use the authenticated owner policy.
--
-- Edge tables NOT scoped (no branch_id column → branch isolation not applicable):
-- events (sport+audience only), drills (global/shared), session_plans/phases.
--
-- Rollback: recreate with
--   USING ((academy_id = current_student_academy()) OR (academy_id = current_staff_academy())).

BEGIN;

DROP POLICY IF EXISTS announcements_anon_read ON public.announcements;

CREATE POLICY announcements_anon_read ON public.announcements
  FOR SELECT TO anon
  USING (
    (
      academy_id = current_staff_academy()
      AND (branch_id IS NULL OR current_staff_branch() IS NULL OR branch_id = current_staff_branch())
      AND (
        sport IS NULL OR sport = ''
        OR current_staff_sports() IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(current_staff_sports()) AS sp
          WHERE lower(sp) = lower(announcements.sport)
        )
      )
    )
    OR academy_id = current_student_academy()
  );

COMMIT;
