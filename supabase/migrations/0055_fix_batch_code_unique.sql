-- ============================================================
-- 0055 — Fix batches_code_academy_unique constraint
-- ============================================================
-- WHY
--   The existing unique constraint treats NULL codes as equal
--   (NULLS NOT DISTINCT), so only one batch per academy can have
--   no code. Most batches don't use a code field. Fix by replacing
--   the constraint with a partial unique index that only fires when
--   code is actually provided (not null, not empty string).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- Drop the old constraint (could be either a table constraint or an index)
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_code_academy_unique;
DROP INDEX IF EXISTS batches_code_academy_unique;

-- Recreate as partial index: only enforce uniqueness when a code is set
CREATE UNIQUE INDEX IF NOT EXISTS batches_code_academy_unique
  ON batches (code, academy_id)
  WHERE code IS NOT NULL AND code <> '';
