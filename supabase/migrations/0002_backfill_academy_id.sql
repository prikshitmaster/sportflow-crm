-- ============================================================
-- 0002 — Backfill academy_id on legacy rows
-- ============================================================
-- Run BEFORE 0003 (strict RLS). Any row with NULL academy_id becomes
-- invisible to the new owner policies — backfill first so nothing
-- disappears.
--
-- Strategy: if there is exactly ONE academy in `academies`, assign
-- every NULL row to that academy. If there are multiple academies,
-- the script ABORTS (raises notice) so a human can decide.
--
-- DEFENSIVE: checks each table + column exists before updating.
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.backfill_if_col(
  tbl text, target uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE updated int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'academy_id'
  ) THEN
    RAISE NOTICE 'skip %: no academy_id column', tbl;
    RETURN;
  END IF;

  EXECUTE format('UPDATE public.%I SET academy_id = $1 WHERE academy_id IS NULL', tbl)
    USING target;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RAISE NOTICE 'backfilled %: % rows', tbl, updated;
END $$;

DO $$
DECLARE
  academy_count INT;
  target_academy UUID;
  tbl text;
BEGIN
  SELECT COUNT(*) INTO academy_count FROM academies;

  IF academy_count = 0 THEN
    RAISE NOTICE 'No academies found — nothing to backfill';
    RETURN;
  END IF;

  IF academy_count > 1 THEN
    RAISE NOTICE 'Multiple academies (%) — backfill aborted. Run per-academy manually.', academy_count;
    RETURN;
  END IF;

  SELECT id INTO target_academy FROM academies LIMIT 1;
  RAISE NOTICE 'Backfilling academy_id = % on legacy rows', target_academy;

  FOREACH tbl IN ARRAY ARRAY[
    'students','batches','staff','payments','trials',
    'announcements','events','leave_requests','fee_plans',
    'audit_logs','student_batches','academy_branches'
  ] LOOP
    PERFORM pg_temp.backfill_if_col(tbl, target_academy);
  END LOOP;

  RAISE NOTICE 'Backfill complete';
END $$;

-- Verification — should all be 0 for tables that have academy_id:
-- SELECT t.table_name, (
--   SELECT COUNT(*) FROM information_schema.columns c
--    WHERE c.table_name = t.table_name AND c.column_name = 'academy_id'
-- ) AS has_col
-- FROM information_schema.tables t
-- WHERE t.table_schema = 'public'
--   AND t.table_name IN ('students','batches','staff','payments','trials',
--                        'announcements','events','leave_requests','fee_plans');

-- ROLLBACK: data backfill, not reversible without a snapshot.
-- If something goes wrong, restore from your Supabase point-in-time backup.
