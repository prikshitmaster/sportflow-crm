-- ============================================================
-- 0015a — DRY RUN: shows attendance duplicates without changing anything
-- ============================================================
-- READ-ONLY. Run this first to see whether you have any duplicate rows
-- before applying the dedupe migration (0015b). If query #1 returns
-- zero rows, you can skip 0015b entirely — your data is already clean.
-- ============================================================

-- ── Query 1: How many duplicate (date, student_id) groups exist? ──
-- These are the rows that 0015b will collapse into one row each.
SELECT
  date,
  student_id,
  COUNT(*) AS row_count,
  array_agg(DISTINCT batch_id) AS batch_ids,
  array_agg(DISTINCT status)   AS statuses
  FROM attendance
 GROUP BY date, student_id
HAVING COUNT(*) > 1
 ORDER BY date DESC
 LIMIT 50;

-- ── Query 2: Aggregate stats ──
-- Total rows that will be touched (kept + deleted = sum of group sizes).
SELECT
  COUNT(*)                             AS duplicate_groups,
  SUM(row_count)                       AS total_rows_in_dupes,
  SUM(row_count) - COUNT(*)            AS rows_that_will_be_deleted,
  COUNT(DISTINCT student_id)           AS students_affected,
  COUNT(DISTINCT date)                 AS dates_affected
  FROM (
    SELECT date, student_id, COUNT(*) AS row_count
      FROM attendance
     GROUP BY date, student_id
    HAVING COUNT(*) > 1
  ) t;

-- ── Query 3: Distribution by status combo ──
-- Tells you which conflicting statuses we'll be resolving. Helps you
-- predict which status the dedupe will "win" for each group.
SELECT
  array_agg(DISTINCT status ORDER BY status) AS conflicting_statuses,
  COUNT(*) AS group_count
  FROM (
    SELECT date, student_id, status
      FROM attendance
     WHERE (date, student_id) IN (
       SELECT date, student_id FROM attendance GROUP BY date, student_id HAVING COUNT(*) > 1
     )
  ) t
 GROUP BY date, student_id
 ORDER BY group_count DESC
 LIMIT 20;

-- Expected outcome:
-- • Query 1 returns 0 rows  → you're already clean, skip 0015b
-- • Query 1 returns ≥1 row  → review them, then run 0015b to merge
