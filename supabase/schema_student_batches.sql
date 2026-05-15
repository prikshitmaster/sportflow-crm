-- ── Multi-batch enrolment ────────────────────────────────
-- Additive: does NOT touch existing students.batch_id column
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS student_batches (
  id         BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL,
  batch_id   BIGINT NOT NULL,
  batch_name TEXT,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  academy_id  UUID,
  UNIQUE(student_id, batch_id)
);

ALTER TABLE student_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access ON student_batches;
CREATE POLICY open_access ON student_batches
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed existing single-batch enrolments into the junction table
-- (safe to run multiple times — UNIQUE constraint prevents duplicates)
INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
SELECT
  s.id,
  s.batch_id,
  s.batch,
  s.academy_id
FROM students s
WHERE s.batch_id IS NOT NULL
ON CONFLICT (student_id, batch_id) DO NOTHING;
