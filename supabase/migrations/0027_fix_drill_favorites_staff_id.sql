-- ============================================================
-- 0027_fix_drill_favorites_staff_id.sql
-- drill_favorites.staff_id was declared uuid but staff_members.id
-- is bigint — same mismatch fixed for session_plans.coach_id in 0025.
-- SAFE: drops unique constraint, alters column, re-adds constraint.
-- ============================================================

-- Drop dependent unique constraint first
ALTER TABLE drill_favorites DROP CONSTRAINT IF EXISTS drill_favorites_drill_id_staff_id_key;

-- Alter column type (no existing data, safe cast)
ALTER TABLE drill_favorites ALTER COLUMN staff_id TYPE bigint USING staff_id::text::bigint;

-- Restore unique constraint
ALTER TABLE drill_favorites ADD CONSTRAINT drill_favorites_drill_id_staff_id_key UNIQUE (drill_id, staff_id);
