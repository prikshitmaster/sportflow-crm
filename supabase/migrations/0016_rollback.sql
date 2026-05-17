-- ============================================================
-- 0016 — Rollback for sport catalog migration (0016b)
-- ============================================================
-- Run this if you need to undo 0016b for any reason.
--
-- WARNING:
--   • This drops academy_sports and sport_branches entirely.
--   • Any rows in those tables will be lost.
--   • academy_branches is NEVER touched by this rollback — its
--     legacy sport data is untouched throughout the whole flow.
--   • Existing students, payments, attendance, batches unaffected.
--
-- Safe to run multiple times (uses IF EXISTS everywhere).
-- ============================================================

BEGIN;

-- ── Step 1: Drop new policies (idempotent)
DROP POLICY IF EXISTS "academy_sports_access"  ON academy_sports;
DROP POLICY IF EXISTS "sport_branches_access"  ON sport_branches;

-- ── Step 2: Drop new tables
DROP TABLE IF EXISTS sport_branches;
DROP TABLE IF EXISTS academy_sports;

-- ── Step 3: Drop the nullable branch columns added by 0016b
-- Safe even if there are rows — they were nullable, no FK dependencies.
ALTER TABLE profiles
  DROP COLUMN IF EXISTS branch_id,
  DROP COLUMN IF EXISTS branch_sport;

ALTER TABLE user_permissions
  DROP COLUMN IF EXISTS branch_id,
  DROP COLUMN IF EXISTS branch_sport;

COMMIT;

-- ============================================================
-- After rollback:
--   • App falls back to current behavior (academy_branches drives /sport-select)
--   • No frontend code change is required to restore the previous state,
--     because Phase 3 frontend changes have not been deployed yet.
-- ============================================================
