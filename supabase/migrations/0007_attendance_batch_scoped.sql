-- 0007: Batch-scoped attendance
-- Adds batch_id to attendance so MWF and TTS marks are stored separately.
-- Student dashboard + export still work: they query by student_id only (all batches merged).

-- 1. Add batch_id column (nullable — null = legacy/admin mark with no batch context)
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS batch_id bigint REFERENCES batches(id) ON DELETE SET NULL;

-- 2. Drop old UNIQUE(date, student_id) constraint
ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_date_student_id_key;

-- 3. New unique index on (date, student_id, batch_id) with NULLS NOT DISTINCT (PG 15+)
--    NULLS NOT DISTINCT: treats NULL as equal, so (date, student1, NULL) stays unique too.
--    This means legacy records (batch_id IS NULL) conflict with each other as before.
--    And (date, student1, batchA) does NOT conflict with (date, student1, batchB).
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_date_student_batch
  ON attendance (date, student_id, batch_id) NULLS NOT DISTINCT;

-- 4. Index for batch_id lookups (skip nulls — not needed for legacy data lookups)
CREATE INDEX IF NOT EXISTS idx_attendance_batch_id
  ON attendance (batch_id) WHERE batch_id IS NOT NULL;
