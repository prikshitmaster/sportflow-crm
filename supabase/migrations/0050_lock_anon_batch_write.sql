-- ============================================================
-- 0050 — Phase 9b: lock anon write on batches + student_batches
-- ============================================================
-- WHY
--   Phase 9a (migration 0049) added 4 SECURITY DEFINER RPCs covering
--   all write paths on batches and student_batches. The raw anon_all
--   policies are now redundant and exploitable.
--
-- BATCH WRITE SURFACE AFTER THIS MIGRATION
--   INSERT new batch       → secure_insert_batch (owner-only)
--   UPDATE batch fields    → secure_update_batch (owner-only, JSONB payload)
--   DELETE batch           → secure_delete_batch (from 0033, owner-only)
--   Enrol student          → secure_assign_student_to_batch (students.manage)
--   Remove student         → secure_unassign_student_from_batch (students.manage)
--   SELECT                 → batches_anon_select / student_batches_anon_select (wide-open)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS batches_anon_all       ON public.batches;
DROP POLICY IF EXISTS student_batches_anon_all ON public.student_batches;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'batches' AND policyname = 'batches_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY batches_anon_select ON public.batches FOR SELECT TO anon USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'student_batches' AND policyname = 'student_batches_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY student_batches_anon_select ON public.student_batches FOR SELECT TO anon USING (true)';
  END IF;
END $$;
