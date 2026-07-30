-- 0107 — branch+sport-isolate the STUDENT arm of announcements_anon_read.
--
-- security-v3/18 scoped the staff arm but left the student arm academy-wide,
-- so any student token could read other branches' announcements directly.
-- New student arm mirrors the client filter (StudentAnnouncements.jsx):
--   • untagged announcement (branch NULL)        → visible
--   • branch-tagged  → only students of that branch
--   • sport-tagged   → only students of that sport (NULL/'' = all)
-- Staff arm and owner (authenticated) policies unchanged.
--
-- Rollback: re-run security-v3/18_branch_pilot_announcements.sql.

BEGIN;

DROP POLICY IF EXISTS announcements_anon_read ON public.announcements;

CREATE POLICY announcements_anon_read ON public.announcements
  FOR SELECT TO anon
  USING (
    -- staff arm (unchanged from security-v3/18)
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
    -- student arm (NEW: branch+sport scoped instead of academy-wide)
    OR (
      academy_id = current_student_academy()
      AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = current_student_id()
          AND s.academy_id = announcements.academy_id
          AND (announcements.branch_id IS NULL OR s.branch_id = announcements.branch_id)
          AND (
            announcements.sport IS NULL OR announcements.sport = ''
            OR lower(COALESCE(s.sport, '')) = lower(announcements.sport)
          )
      )
    )
  );

COMMIT;
