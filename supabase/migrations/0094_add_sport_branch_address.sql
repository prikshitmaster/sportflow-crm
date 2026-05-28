-- 0094 — Add address column to sport_branches
--
-- Migration 0018 defined this column but was never applied to production.
-- Migration 0053's secure_insert_sport_branch RPC already references it,
-- causing "column address does not exist" on every branch add attempt.
--
-- IDEMPOTENT (IF NOT EXISTS).

BEGIN;

ALTER TABLE sport_branches
  ADD COLUMN IF NOT EXISTS address text;

COMMIT;
