-- 0074 — Backfill branch_id on students created before 0073
--
-- Students added via the old create_student_with_payment had branch_id = NULL,
-- making them invisible to branch managers under strict branch isolation.
-- A student trains at their batch's branch, so derive branch_id from the batch.
-- IDEMPOTENT — only touches rows that are still NULL and whose batch has a branch.

BEGIN;

UPDATE students s
   SET branch_id = b.branch_id
  FROM batches b
 WHERE s.batch_id = b.id
   AND s.branch_id IS NULL
   AND b.branch_id IS NOT NULL;

COMMIT;
