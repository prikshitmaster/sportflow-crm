-- ============================================================
-- 0018 — Rollback (drops address column from sport_branches)
-- ============================================================
-- WARNING: Any addresses entered through the UI will be lost.
-- ============================================================

BEGIN;
ALTER TABLE sport_branches DROP COLUMN IF EXISTS address;
COMMIT;
