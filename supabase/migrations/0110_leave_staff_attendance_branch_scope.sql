-- 0110 — lock staff_checkins reads + branch-isolate leave_requests.
--
-- staff_checkins (the LIVE clock-in table, migration 0085) shipped with
-- "checkins_read" USING (true) — readable by ANY caller with the anon key,
-- across every academy. Replace with:
--   • anon arm  — own-academy staff tokens only, branch-scoped: branch-locked
--     staff see check-ins of staff in their own branch (or branch-less staff);
--     office/multi-branch staff (NULL branch) see the whole academy. Own rows
--     always visible (a staff member is in their own branch).
--   • authenticated arm — owner, own academy.
--
-- leave_requests: academy-wide for any staff token (security-v3/09) → now
-- branch-scoped the same way. Owner (authenticated) policies unchanged.
--
-- NOTE: the legacy staff_attendance table (unused by the app) keeps its
-- academy-scoped policy from security-v3/09 — it has no staff_id column,
-- which is what made the first version of this migration fail.
--
-- Rollback:
--   staff_checkins → CREATE POLICY "checkins_read" ON staff_checkins FOR SELECT USING (true);
--   leave_requests → recreate with USING (academy_id = current_staff_academy()).

BEGIN;

DROP POLICY IF EXISTS "checkins_read"          ON public.staff_checkins;
DROP POLICY IF EXISTS staff_checkins_anon_read ON public.staff_checkins;
DROP POLICY IF EXISTS staff_checkins_auth_read ON public.staff_checkins;

CREATE POLICY staff_checkins_anon_read ON public.staff_checkins
  FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    AND (
      current_staff_branch() IS NULL
      OR EXISTS (
        SELECT 1 FROM staff st
        WHERE st.id = staff_checkins.staff_id
          AND (st.branch_id IS NULL OR st.branch_id = current_staff_branch())
      )
    )
  );

CREATE POLICY staff_checkins_auth_read ON public.staff_checkins
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

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
