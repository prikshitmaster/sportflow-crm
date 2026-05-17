-- ============================================================
-- 0015b — Attendance dedupe + future-proof unique constraint
-- ============================================================
-- Fixes QA_AUDIT C1: QR scan and coach/admin save used different UPSERT
-- conflict keys, allowing 2 rows per (date, student_id) — one with
-- batch_id=NULL (from QR) and one with batch_id=<some id> (from coach).
--
-- This migration is wrapped in a transaction. If anything goes wrong,
-- nothing commits. The whole thing is also re-runnable: the final unique
-- index uses IF NOT EXISTS.
--
-- BEFORE running, run 0015a_attendance_dryrun.sql to see what will change.
-- If Query 1 in 0015a returned 0 rows, you don't need to run this file.
-- ============================================================

BEGIN;

-- ── Step 1: Safety net — snapshot duplicate rows into a temp audit table
-- so you can recover any data we delete in step 3. Auto-dropped on commit.
CREATE TEMP TABLE attendance_dedupe_audit ON COMMIT DROP AS
SELECT *, now() AS snapshot_at
  FROM attendance
 WHERE (date, student_id) IN (
   SELECT date, student_id FROM attendance GROUP BY date, student_id HAVING COUNT(*) > 1
 );

-- (Optional) Persist the audit table for post-commit inspection. Uncomment
-- the next 2 lines if you want a permanent audit copy:
-- CREATE TABLE IF NOT EXISTS attendance_dedupe_audit_2026_05_17 AS SELECT * FROM attendance_dedupe_audit;
-- COMMENT ON TABLE attendance_dedupe_audit_2026_05_17 IS 'Snapshot before 0015b ran';


-- ── Step 2: Build the merged row for each (date, student_id) group
-- Rules:
--   status   = highest precedence among conflicting statuses
--              Present(4) > Late(3) > Leave(2) > Absent(1)
--   batch_id = first non-null batch_id from the group (coach-marked
--              wins over QR's NULL batch). If all NULL, stay NULL.
--   present  = TRUE iff resolved status is Present
--   id       = smallest existing id from the group (keep one canonical row)
CREATE TEMP TABLE attendance_merged ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    date,
    student_id,
    status,
    batch_id,
    id,
    CASE status
      WHEN 'Present' THEN 4
      WHEN 'Late'    THEN 3
      WHEN 'Leave'   THEN 2
      WHEN 'Absent'  THEN 1
      ELSE 0
    END AS precedence
    FROM attendance
   WHERE (date, student_id) IN (
     SELECT date, student_id FROM attendance GROUP BY date, student_id HAVING COUNT(*) > 1
   )
)
SELECT
  date,
  student_id,
  (array_agg(status ORDER BY precedence DESC, id ASC))[1] AS resolved_status,
  (array_agg(batch_id ORDER BY (batch_id IS NULL), id ASC))[1] AS resolved_batch_id,
  MIN(id) AS keep_id
  FROM ranked
 GROUP BY date, student_id;


-- ── Step 3: Delete all duplicate rows EXCEPT the one we'll update in place
DELETE FROM attendance a
 USING attendance_merged m
 WHERE a.date       = m.date
   AND a.student_id = m.student_id
   AND a.id        != m.keep_id;


-- ── Step 4: Update the surviving row to carry the resolved status/batch
UPDATE attendance a
   SET status   = m.resolved_status,
       present  = (m.resolved_status = 'Present'),
       batch_id = m.resolved_batch_id
  FROM attendance_merged m
 WHERE a.id = m.keep_id;


-- ── Step 5: Future-proof — partial unique index for batch_id=NULL rows.
-- The existing composite unique key (date, student_id, batch_id) doesn't
-- block duplicates when batch_id is NULL (Postgres treats NULLs as distinct).
-- This partial index closes that hole specifically for QR-path inserts.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_date_student_nullbatch_uniq
  ON attendance (date, student_id)
  WHERE batch_id IS NULL;


-- ── Step 6: Verification — must return 0 rows. If not, ROLLBACK.
DO $$
DECLARE
  dupe_count INT;
BEGIN
  SELECT COUNT(*) INTO dupe_count
    FROM (
      SELECT date, student_id FROM attendance GROUP BY date, student_id HAVING COUNT(*) > 1
    ) t;
  IF dupe_count > 0 THEN
    RAISE EXCEPTION 'Dedupe failed — % duplicate groups remain. Rolling back.', dupe_count;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- Post-commit smoke test (run AFTER the COMMIT above)
-- ============================================================
-- 1. Confirm zero duplicates:
--    SELECT COUNT(*) FROM (SELECT date, student_id FROM attendance GROUP BY 1,2 HAVING COUNT(*) > 1) t;
--    → 0
--
-- 2. Confirm partial unique index exists:
--    SELECT indexdef FROM pg_indexes WHERE indexname = 'attendance_date_student_nullbatch_uniq';
--    → returns 1 row showing the index definition
--
-- 3. Test the new guard works:
--    INSERT INTO attendance (date, student_id, batch_id, present, status)
--           VALUES (CURRENT_DATE, <SOME_STUDENT_ID>, NULL, true, 'Present');
--    INSERT INTO attendance (date, student_id, batch_id, present, status)
--           VALUES (CURRENT_DATE, <SAME_STUDENT_ID>, NULL, true, 'Present');
--    → second insert should fail with: duplicate key value violates unique constraint
--      "attendance_date_student_nullbatch_uniq"
--    (Cleanup: DELETE FROM attendance WHERE student_id = <SOME_STUDENT_ID> AND date = CURRENT_DATE;)
--
-- ============================================================
-- ROLLBACK (only if you applied this file and need to undo step 5)
-- ============================================================
-- The DELETE/UPDATE in steps 3–4 are NOT recoverable without a DB backup.
-- The audit table in step 1 (commented optional persist) is your safety net.
-- Step 5's index can be dropped harmlessly:
--    DROP INDEX IF EXISTS attendance_date_student_nullbatch_uniq;
