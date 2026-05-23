-- 0071 — Backfill attendance.batch_id from students.batch_id
-- 124 attendance rows have batch_id = NULL because they were saved from
-- the owner Attendance page while no batch pill was selected. Those rows
-- vanished from batch-specific views (they only showed in "All").
--
-- Step 1: Drop NULL-batch rows that duplicate an already-batched row for the
--         same (date, student) — same status anyway, just redundant.
-- Step 2: Set batch_id = students.batch_id for the remaining NULL rows.

BEGIN;

DELETE FROM attendance a
USING attendance b, students s
WHERE a.batch_id IS NULL
  AND b.batch_id IS NOT NULL
  AND a.student_id = b.student_id
  AND a.date       = b.date
  AND a.student_id = s.id
  AND b.batch_id   = s.batch_id;

UPDATE attendance a
SET batch_id = s.batch_id
FROM students s
WHERE a.student_id = s.id
  AND a.batch_id IS NULL
  AND s.batch_id IS NOT NULL;

COMMIT;
