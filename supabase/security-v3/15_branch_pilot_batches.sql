-- security-v3 / Phase 4-C (2/4) — branch+sport-isolate batches_anon_read
--
-- Batches carry branch_id + sports[] (array). The client filters batches by
-- branch AND sport-overlap (clean — no batch-membership recursion like students),
-- so the DB can enforce BOTH. Sport match is a case-insensitive array overlap to
-- mirror the client's lowercased comparison.
--
-- PRESERVED: the student clause (academy_id = current_student_academy()) — students
-- read all academy batches for their dashboard/scan (days, times). Owners use
-- batches_owner_all (authenticated).
--
-- Rollback: recreate with
--   USING ((academy_id = current_staff_academy()) OR (academy_id = current_student_academy())).

BEGIN;

DROP POLICY IF EXISTS batches_anon_read ON public.batches;

CREATE POLICY batches_anon_read ON public.batches
  FOR SELECT TO anon
  USING (
    (
      academy_id = current_staff_academy()
      AND (current_staff_branch() IS NULL OR branch_id = current_staff_branch())
      AND (
        current_staff_sports() IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(batches.sports) AS bsport
          JOIN unnest(current_staff_sports()) AS ssport
            ON lower(bsport) = lower(ssport)
        )
      )
    )
    OR academy_id = current_student_academy()
  );

COMMIT;
