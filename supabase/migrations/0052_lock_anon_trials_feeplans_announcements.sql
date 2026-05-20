-- ============================================================
-- 0052 — Phase 10b: lock anon write on trials, fee_plans, announcements
-- ============================================================
-- WHY
--   Phase 10a (migration 0051) added 9 SECURITY DEFINER RPCs covering all
--   write paths. The raw anon_all policies are now redundant.
--
-- WRITE SURFACE AFTER THIS MIGRATION
--   trials         → secure_insert/update/delete_trial (trials.manage)
--   trial_sources  → secure_insert/delete_trial_source (trials.manage)
--   fee_plans      → secure_insert/update/delete_fee_plan (owner only)
--   announcements  → secure_insert_announcement (owner or staff)
--   SELECT         → *_anon_select (wide-open on all four tables)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS trials_anon_all        ON public.trials;
DROP POLICY IF EXISTS trial_sources_anon_all ON public.trial_sources;
DROP POLICY IF EXISTS fee_plans_anon_all     ON public.fee_plans;
DROP POLICY IF EXISTS announcements_anon_all ON public.announcements;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT unnest(ARRAY[
    'trials', 'trial_sources', 'fee_plans', 'announcements'
  ]) AS tbl LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = rec.tbl
        AND policyname = rec.tbl || '_anon_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
        rec.tbl || '_anon_select', rec.tbl
      );
    END IF;
  END LOOP;
END $$;
