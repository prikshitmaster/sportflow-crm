-- ============================================================
-- 0016a — Sport Catalog + Branch Model — DRY RUN (read-only)
-- ============================================================
-- Run this FIRST in Supabase SQL editor. Nothing is modified.
-- The queries below tell us:
--   1. What sport names already exist in academy_branches
--   2. Which of those names match the proposed catalog
--   3. What free-text sports exist on students (may need cleanup)
--   4. Whether the new columns we plan to add already exist
--
-- If Query 4 returns any rows, the new columns ALREADY exist —
-- safe to proceed (migration 0016b is idempotent), but worth noting.
-- ============================================================

-- ── Query 1: Existing sport names in academy_branches
-- These are the "sports" the app currently shows on /sport-select
SELECT academy_id, name, created_at
  FROM academy_branches
 ORDER BY academy_id, name;

-- ── Query 2: Which existing names match the proposed catalog
-- Names that do NOT match will stay in academy_branches (backward compat)
-- and will NOT be auto-migrated.
SELECT name,
       (name IN (
         'Football','Cricket','Tennis','Squash','Table Tennis',
         'Basketball','Badminton','Swimming','Volleyball','Hockey'
       )) AS in_catalog,
       COUNT(*) AS occurrences
  FROM academy_branches
 GROUP BY name
 ORDER BY in_catalog DESC, name;

-- ── Query 3: Distinct students.sport values
-- Tells us what sport names are referenced by actual student records.
-- We do NOT alter students — this is purely informational.
SELECT sport, COUNT(*) AS student_count
  FROM students
 WHERE sport IS NOT NULL AND sport <> ''
 GROUP BY sport
 ORDER BY student_count DESC;

-- ── Query 4: Check if branch_id / branch_sport columns already exist
-- If empty (0 rows), migration 0016b will add them.
-- If present, 0016b's "ADD COLUMN IF NOT EXISTS" will be a no-op.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('profiles','user_permissions')
   AND column_name IN ('branch_id','branch_sport')
 ORDER BY table_name, column_name;

-- ── Query 5: Check if the new tables already exist (collision check)
-- If 0 rows, we're clear to create them.
-- If they exist, 0016b's "CREATE TABLE IF NOT EXISTS" is a no-op.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('academy_sports','sport_branches');

-- ── Query 6: Distinct batch sports (informational only — we do NOT touch batches)
SELECT unnest(sports) AS sport_name, COUNT(*) AS batch_count
  FROM batches
 WHERE sports IS NOT NULL AND array_length(sports, 1) > 0
 GROUP BY sport_name
 ORDER BY batch_count DESC;

-- ── Query 7: Existing access_role values on user_permissions
-- Confirms what roles exist today — we'll add 'branch_manager' as a new value.
SELECT access_role, COUNT(*) AS user_count
  FROM user_permissions
 GROUP BY access_role
 ORDER BY user_count DESC;
