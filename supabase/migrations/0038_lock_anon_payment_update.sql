-- ============================================================
-- 0038 — Phase 2 Stage 5b: lock anon UPDATE on payments
-- ============================================================
-- WHY
--   Stage 5a (migration 0037) added secure_update_payment but the anon
--   role still has UPDATE permission on the payments table via the
--   payments_anon_update policy from migration 0034. A coach with the
--   anon key could still bypass the RPC by updating raw:
--     supabase.from('payments').update({ status: 'Paid' }).eq('id', 'INV-123')
--   This closes that hole by removing the payments_anon_update policy.
--   After this, only secure_update_payment (SECURITY DEFINER, bypasses
--   RLS) can modify the payments table from the anon path.
--
-- PRE-CONDITION
--   Apply AFTER migration 0037 AND after wiring db.js to call
--   secure_update_payment in place of raw .update() calls.
--
-- WHAT THIS DOES NOT TOUCH
--   • payments_anon_select — reads still allowed at table level.
--   • create_student_with_payment, secure_insert_payment — SECURITY
--     DEFINER, bypass RLS, continue to work.
--
-- PAYMENT WRITE SURFACE AFTER THIS MIGRATION
--   INSERT  → secure_insert_payment only (locked in 0036)
--   UPDATE  → secure_update_payment only (locked here)
--   DELETE  → secure_delete_payment only (locked in 0034)
--   SELECT  → payments_anon_select, wide-open (intentional)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS payments_anon_update ON public.payments;

-- Sanity: SELECT policy should remain. Recreate if somehow missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments'
      AND policyname = 'payments_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY payments_anon_select ON public.payments FOR SELECT TO anon USING (true)';
  END IF;
END $$;
