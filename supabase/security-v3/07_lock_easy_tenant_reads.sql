-- security-v3 / 07 — Phase 3.3a: drop the shadow USING(true) anon SELECT
-- policies on tables where a properly-scoped *_anon_read policy already
-- exists alongside.
--
-- These tables today have TWO permissive SELECT policies for anon:
--   *_anon_read    USING (academy_id = current_staff_academy() OR ...)   -- scoped, correct
--   *_anon_select  USING (true)                                          -- wide-open shadow
--
-- Because RLS policies are permissive (any matching policy grants
-- access), the USING(true) one always wins. Dropping it makes the
-- scoped one the only path, immediately closing the cross-academy read
-- leak on these tables.
--
-- Tables in this batch (all already have scoped _anon_read):
--   - payments        scope: staff academy OR own student_id
--   - batches         scope: staff academy OR student academy
--   - announcements   scope: staff academy OR student academy
--
-- Owner authenticated reads via the _owner_all policy continue to work
-- unchanged. RPC writes continue to work (SECURITY DEFINER bypass).
--
-- Tables NOT in this batch (handled in security-v3/08 and later):
--   students      — needs RPC for student-side batchmate listing
--   attendance    — needs a scoped policy created (only has the shadow)
--   trials        — same
--   fee_plans, skill_assessments, player_goals, drills, events, etc.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

DROP POLICY IF EXISTS payments_anon_select      ON public.payments;
DROP POLICY IF EXISTS batches_anon_select       ON public.batches;
DROP POLICY IF EXISTS announcements_anon_select ON public.announcements;

COMMIT;
