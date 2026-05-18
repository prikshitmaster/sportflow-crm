-- ============================================================
-- 0025_fix_session_id_types.sql
-- Fix batch_id and coach_id column types in session_plans
-- The batches and staff tables use bigint IDs, not UUIDs
-- SAFE: tables are empty; drops/recreates columns only
-- ============================================================

-- Drop unique constraint that includes batch_id (will re-add after)
ALTER TABLE session_plans DROP CONSTRAINT IF EXISTS session_plans_batch_id_date_key;

-- Drop old indexes
DROP INDEX IF EXISTS session_plans_batch_idx;
DROP INDEX IF EXISTS session_plans_coach_idx;

-- Re-create batch_id and coach_id as bigint
ALTER TABLE session_plans DROP COLUMN IF EXISTS batch_id;
ALTER TABLE session_plans DROP COLUMN IF EXISTS coach_id;
ALTER TABLE session_plans ADD COLUMN batch_id bigint;
ALTER TABLE session_plans ADD COLUMN coach_id bigint;

-- Restore unique constraint and indexes
ALTER TABLE session_plans ADD CONSTRAINT session_plans_batch_id_date_key UNIQUE (batch_id, date);
CREATE INDEX IF NOT EXISTS session_plans_batch_idx ON session_plans (batch_id);
CREATE INDEX IF NOT EXISTS session_plans_coach_idx ON session_plans (coach_id);
