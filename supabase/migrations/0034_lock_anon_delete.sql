-- ============================================================
-- 0034 — Phase 2 Stage 2: lock anon DELETE on protected tables
-- ============================================================
-- WHY
--   Stage 1 (migration 0033) added secure_delete_* RPCs that gate
--   destructive deletes behind token validation. But anon DELETE
--   was still wide-open from migration 0032, so a malicious user
--   with DevTools could call .from('students').delete(...) directly
--   and bypass the RPC entirely.
--
-- WHAT THIS DOES
--   Replaces the catch-all `*_anon_all` policies on students, payments,
--   batches, and staff with three narrower policies (SELECT, INSERT,
--   UPDATE) — explicitly leaving out DELETE. After this, anon callers
--   can still read and write rows (so the app keeps working), but
--   DELETE is only possible through the SECURITY DEFINER secure_delete_*
--   RPCs, which validate the caller's identity and academy.
--
-- WHAT THIS DOES NOT TOUCH
--   • authenticated role policies — owners may still have other DELETE
--     paths via authenticated policies. Stage 2 only closes the anon hole.
--   • Other tables (attendance, trials, etc.) — still wide-open. Future
--     stages can extend this pattern.
--
-- IDEMPOTENT — safe to re-run. Each policy is dropped before recreate.
-- ============================================================

DO $$
DECLARE
  protected_tables text[] := ARRAY['students','payments','batches','staff'];
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    -- Sanity: skip if table doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'skip % — table does not exist', t;
      CONTINUE;
    END IF;

    -- Drop the catch-all anon policy from 0032 (any name variant)
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname IN (t || '_anon_all', t || '_anon_rw',
                           t || '_anon_select', t || '_anon_insert',
                           t || '_anon_update', t || '_anon_delete')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;

    -- Re-create as three narrower policies. No DELETE policy means
    -- anon DELETE is now blocked by RLS.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
      t || '_anon_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (true)',
      t || '_anon_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (true) WITH CHECK (true)',
      t || '_anon_update', t
    );

    RAISE NOTICE 'anon DELETE locked on % (RW policies preserved)', t;
  END LOOP;
END $$;
