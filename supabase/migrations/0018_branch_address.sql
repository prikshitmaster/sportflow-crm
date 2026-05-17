-- ============================================================
-- 0018 — Branch address column
-- ============================================================
-- Adds an optional `address` column to sport_branches.
-- Fully additive, idempotent, nullable. No data touched.
-- Rollback: 0018_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE sport_branches
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN sport_branches.address IS 'Optional human-readable address / location of the branch.';

COMMIT;
