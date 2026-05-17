-- ============================================================
-- 0017 — Rollback for branch isolation migration (0017b)
-- ============================================================
-- WARNING:
--   • Drops the branch_id column from students/batches/staff/trials/audit_logs
--   • Any branch assignments will be lost
--   • Does NOT undo the sport-name normalization (INITCAP) in Step 2 of 0017b —
--     those updates only changed case (e.g. 'football' → 'Football') and are
--     compatible with both the old and new code paths
--   • Does NOT undo the legacy "Football _ARA _ branch 2" → "Football" renames
--     in students.sport (Step 5), batches.sports[] (Step 6a), trials.sport (Step 8a) —
--     to restore the original strings you would need the dryrun captures
--     (Query 3 + Query 1) you saved before applying 0017b
--   • sport_branches rows created during backfill ARE deleted in this rollback
--     so the parent 0016 tables remain consistent
--
-- Safe to re-run.
-- ============================================================

BEGIN;

-- ── Step 1: Drop branch_id from per-tenant tables (nullable → safe drop)
ALTER TABLE students   DROP COLUMN IF EXISTS branch_id;
ALTER TABLE batches    DROP COLUMN IF EXISTS branch_id;
ALTER TABLE staff      DROP COLUMN IF EXISTS branch_id;
ALTER TABLE trials     DROP COLUMN IF EXISTS branch_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS branch_id;

-- ── Step 2: Clean up sport_branches rows that 0017b created
-- We only delete rows named "Branch 1" or "Branch 2" since those are the
-- ones the migration auto-created. Any manually-added branch is preserved.
DELETE FROM sport_branches
 WHERE branch_name IN ('Branch 1', 'Branch 2');

COMMIT;

-- ============================================================
-- After rollback:
--   • students.sport / batches.sports / staff.sports stay normalized (Title Case)
--   • Legacy 'Football _ARA _ branch 2' STUDENTS now have sport='Football'
--     (Step 5's UPDATE is not reverted — to restore, run:
--        UPDATE students SET sport='Football _ARA _ branch 2'
--         WHERE id IN (<list of ids you noted before migration>);
--      from the dryrun Query 3 output you captured)
--   • If you need the legacy string back, capture Query 3 output BEFORE running 0017b
-- ============================================================
