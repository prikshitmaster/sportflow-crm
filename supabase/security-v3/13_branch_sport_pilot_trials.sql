-- security-v3 / Phase 4-B — branch+sport-aware read policy PILOT on `trials`
--
-- First policy that actually narrows staff reads at the DB. Mirrors the client
-- AppContext filter: a staff token can now only SELECT trials in its own branch
-- and sport. Office/multi-branch staff (NULL branch) and no-sport staff are
-- unaffected (the IS NULL bypasses preserve "see all branches / all sports").
--
-- Owners are untouched (they use trials_owner_all, role = authenticated).
-- Sport match is case-insensitive to mirror the client's lowercased comparison.
--
-- Rollback: recreate trials_anon_read with USING (academy_id = current_staff_academy()).

BEGIN;

DROP POLICY IF EXISTS trials_anon_read ON public.trials;

CREATE POLICY trials_anon_read ON public.trials
  FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    AND (current_staff_branch() IS NULL OR branch_id = current_staff_branch())
    AND (
      current_staff_sports() IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(current_staff_sports()) AS sp
        WHERE lower(sp) = lower(trials.sport)
      )
    )
  );

COMMIT;
