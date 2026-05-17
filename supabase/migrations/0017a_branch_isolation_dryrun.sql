-- ============================================================
-- 0017a — Full Branch Isolation — DRY RUN (read-only)
-- ============================================================
-- Run FIRST in Supabase SQL editor. Nothing modified.
-- Tells us what 0017b will do:
--   • How many students/batches/staff/trials per sport
--   • How many will go to "Branch 1" auto-assignment
--   • Which records will be moved to "Branch 2" (Football _ARA _ branch 2 cases)
-- ============================================================

-- ── Query 1: Distinct sport values referenced anywhere in data
-- These are the sports we'll create "Branch 1" for during backfill.
SELECT 'students' AS source, sport AS value, COUNT(*) AS rows
  FROM students WHERE sport IS NOT NULL AND sport <> ''
  GROUP BY sport
UNION ALL
SELECT 'batches',  unnest(sports), COUNT(*) FROM batches  WHERE sports IS NOT NULL GROUP BY unnest(sports)
UNION ALL
SELECT 'staff',    unnest(sports), COUNT(*) FROM staff    WHERE sports IS NOT NULL GROUP BY unnest(sports)
UNION ALL
SELECT 'trials',   sport,          COUNT(*) FROM trials   WHERE sport  IS NOT NULL GROUP BY sport
 ORDER BY source, value;

-- ── Query 2: Catalog match per sport (case-insensitive)
-- Sport values that match catalog → become "Football", "Cricket" etc. with Branch 1
-- Sport values NOT in catalog → flagged for manual review
SELECT DISTINCT
  sport AS raw_value,
  CASE
    WHEN LOWER(sport) IN ('football','cricket','tennis','squash','table tennis',
                          'basketball','badminton','swimming','volleyball','hockey')
    THEN INITCAP(LOWER(sport))
    WHEN LOWER(sport) LIKE 'football%branch%2%' THEN 'Football'   -- legacy pattern
    ELSE '__UNMAPPED__'
  END AS canonical_sport,
  CASE
    WHEN LOWER(sport) LIKE 'football%branch%2%' THEN 'Branch 2'
    ELSE 'Branch 1'
  END AS target_branch
FROM (
  SELECT sport FROM students WHERE sport IS NOT NULL
  UNION SELECT sport FROM trials   WHERE sport IS NOT NULL
) t
ORDER BY canonical_sport, target_branch;

-- ── Query 3: Students that match the legacy "branch 2" pattern
-- These get reassigned to Branch 2 of Football (NOT Branch 1).
-- ★ SAVE THIS OUTPUT — manual rollback insurance.
SELECT id, name, sport, batch_id, academy_id
  FROM students
 WHERE LOWER(sport) LIKE 'football%branch%2%'
 ORDER BY id;

-- ── Query 3b: Batches that match the legacy "branch 2" pattern
-- These will have 'Football _ARA _ branch 2' replaced with 'Football' in sports[]
-- and get branch_id = Football/Branch 2.
-- ★ SAVE THIS OUTPUT — manual rollback insurance.
SELECT id, name, sports, academy_id
  FROM batches
 WHERE 'Football _ARA _ branch 2' = ANY(sports)
 ORDER BY id;

-- ── Query 3c: Trials that match the legacy "branch 2" pattern
-- These will have sport renamed to 'Football' and get branch_id = Football/Branch 2.
-- ★ SAVE THIS OUTPUT — manual rollback insurance.
SELECT id, name, sport, academy_id
  FROM trials
 WHERE LOWER(sport) LIKE 'football%branch%2%'
 ORDER BY id;

-- ── Query 4: Check if branch_id columns already exist
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name = 'branch_id'
   AND table_name IN ('students','batches','staff','trials','audit_logs');

-- ── Query 5: Confirm 0016b tables exist (prerequisite)
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('academy_sports','sport_branches');

-- ── Query 6: Rows in sport_branches today (should be 0 — none created yet)
SELECT academy_id, sport_name, branch_name FROM sport_branches ORDER BY 1,2,3;

-- ── Query 7: Total counts that will be affected by backfill
SELECT 'students_total' AS metric, COUNT(*)::text AS value FROM students
UNION ALL
SELECT 'batches_total',  COUNT(*)::text FROM batches
UNION ALL
SELECT 'staff_total',    COUNT(*)::text FROM staff
UNION ALL
SELECT 'trials_total',   COUNT(*)::text FROM trials
UNION ALL
SELECT 'distinct_sports', COUNT(DISTINCT sport)::text FROM students WHERE sport IS NOT NULL AND sport <> '';
