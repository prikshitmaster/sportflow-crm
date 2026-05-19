-- ============================================================
-- 0036 — Phase 2 Stage 4: lock anon INSERT on payments
-- ============================================================
-- WHY
--   Stage 3 (migration 0035) added secure_insert_payment but the anon
--   role still has INSERT permission on the payments table via the
--   policy from migration 0034. A coach with the anon key could
--   bypass the RPC by inserting raw:
--     supabase.from('payments').insert({ ..., status: 'Paid' })
--   This closes that hole by removing the payments_anon_insert policy.
--   After this, only secure_insert_payment (SECURITY DEFINER, bypasses
--   RLS) can write to the payments table from the anon path.
--
-- WHAT THIS DOES NOT TOUCH
--   • payments_anon_select / payments_anon_update — reads and status
--     edits still allowed at the table level. Update lockdown comes
--     in a future stage (separate secure_update_payment RPC needed).
--   • create_student_with_payment RPC — SECURITY DEFINER, bypasses
--     RLS, continues to work for atomic student+payment creation.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS payments_anon_insert ON public.payments;

-- Sanity: the SELECT + UPDATE policies should remain. If somehow this
-- migration is run before 0034, recreate them so we don't break reads.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments'
      AND policyname = 'payments_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY payments_anon_select ON public.payments FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments'
      AND policyname = 'payments_anon_update'
  ) THEN
    EXECUTE 'CREATE POLICY payments_anon_update ON public.payments FOR UPDATE TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;
