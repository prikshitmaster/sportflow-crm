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
-- ============================================================

DO $$
DECLARE
  academy_count INT;
  target_academy UUID;
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

  UPDATE students         SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE batches          SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE staff            SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE payments         SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE trials           SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE announcements    SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE events           SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE leave_requests   SET academy_id = target_academy WHERE academy_id IS NULL;
  UPDATE fee_plans        SET academy_id = target_academy WHERE academy_id IS NULL;

  -- attendance / staff_attendance / student_batches inherit through student/staff/batch FKs;
  -- if you have an academy_id column on them too, repeat the pattern.

  RAISE NOTICE 'Backfill complete';
END $$;

-- Verification — should all be 0
-- SELECT 'students'         AS table, COUNT(*) FROM students         WHERE academy_id IS NULL
-- UNION ALL SELECT 'batches',         COUNT(*) FROM batches          WHERE academy_id IS NULL
-- UNION ALL SELECT 'staff',           COUNT(*) FROM staff            WHERE academy_id IS NULL
-- UNION ALL SELECT 'payments',        COUNT(*) FROM payments         WHERE academy_id IS NULL
-- UNION ALL SELECT 'trials',          COUNT(*) FROM trials           WHERE academy_id IS NULL
-- UNION ALL SELECT 'announcements',   COUNT(*) FROM announcements    WHERE academy_id IS NULL
-- UNION ALL SELECT 'events',          COUNT(*) FROM events           WHERE academy_id IS NULL
-- UNION ALL SELECT 'leave_requests',  COUNT(*) FROM leave_requests   WHERE academy_id IS NULL
-- UNION ALL SELECT 'fee_plans',       COUNT(*) FROM fee_plans        WHERE academy_id IS NULL;

-- ROLLBACK: this is a data backfill, not reversible without a snapshot.
-- If something goes wrong, restore from your Supabase point-in-time backup.
