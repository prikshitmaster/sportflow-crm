-- ============================================================
-- 0016b — Sport Catalog + Branch Model — APPLY (additive)
-- ============================================================
-- Run this AFTER reviewing the dryrun output (0016a).
--
-- Guarantees:
--   • Wrapped in BEGIN/COMMIT — atomic, rollback on any error
--   • Fully idempotent — safe to re-run
--   • NO destructive changes:
--       - No DROP / no ALTER existing column / no rename
--       - No row modifications to students / batches / payments / staff / trials
--       - academy_branches is LEFT UNTOUCHED (legacy data preserved)
--   • New columns are NULLABLE — existing rows continue to work
--   • RLS mirrors the existing academy_branches policy
--
-- Rollback: see 0016_rollback.sql
-- ============================================================

BEGIN;

-- ── Step 1: New table — sport catalog per academy
-- A sport_name must be from the frontend catalog. App-level enforcement;
-- no DB CHECK constraint so the catalog can evolve without migrations.
CREATE TABLE IF NOT EXISTS academy_sports (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id  uuid NOT NULL,
  sport_name  text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (academy_id, sport_name)
);
CREATE INDEX IF NOT EXISTS academy_sports_academy_id_idx
  ON academy_sports (academy_id);

-- ── Step 2: New table — branches under a sport
-- Example: Football → Branch 1, Branch 2, Branch 3 (3 rows)
-- Same sport_name may appear under multiple academies.
CREATE TABLE IF NOT EXISTS sport_branches (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id   uuid NOT NULL,
  sport_name   text NOT NULL,
  branch_name  text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (academy_id, sport_name, branch_name)
);
CREATE INDEX IF NOT EXISTS sport_branches_academy_id_idx
  ON sport_branches (academy_id);
CREATE INDEX IF NOT EXISTS sport_branches_sport_idx
  ON sport_branches (academy_id, sport_name);

-- ── Step 3: Branch-manager scoping columns (nullable on existing tables)
-- Owner/coach/admin/etc. continue working — these stay NULL for them.
-- Only branch managers will have these set; AppContext filters on them.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS branch_id    uuid,
  ADD COLUMN IF NOT EXISTS branch_sport text;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS branch_id    uuid,
  ADD COLUMN IF NOT EXISTS branch_sport text;

-- ── Step 4: Backfill — copy catalog-matching academy_branches into academy_sports
-- Names that do NOT match the catalog are left alone in academy_branches.
-- The app will still display them from the legacy source (backward compat).
INSERT INTO academy_sports (academy_id, sport_name)
SELECT DISTINCT academy_id, name
  FROM academy_branches
 WHERE name IN (
   'Football','Cricket','Tennis','Squash','Table Tennis',
   'Basketball','Badminton','Swimming','Volleyball','Hockey'
 )
ON CONFLICT (academy_id, sport_name) DO NOTHING;

-- ── Step 5: RLS — mirror exactly the academy_branches policy
ALTER TABLE academy_sports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_branches  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_sports_access" ON academy_sports;
CREATE POLICY "academy_sports_access" ON academy_sports FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

DROP POLICY IF EXISTS "sport_branches_access" ON sport_branches;
CREATE POLICY "sport_branches_access" ON sport_branches FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── Step 6: Comments for future-you
COMMENT ON TABLE academy_sports  IS 'Per-academy registry of active sports (from frontend SPORT_CATALOG). Replaces legacy use of academy_branches as a sport list.';
COMMENT ON TABLE sport_branches  IS 'Physical branches under a sport, e.g. Football → Branch 1/2/3.';
COMMENT ON COLUMN profiles.branch_id          IS 'Set only for branch_manager users — points to sport_branches.id';
COMMENT ON COLUMN profiles.branch_sport       IS 'Set only for branch_manager users — sport_name of their branch';
COMMENT ON COLUMN user_permissions.branch_id    IS 'Mirror of profiles.branch_id for permission-time scoping';
COMMENT ON COLUMN user_permissions.branch_sport IS 'Mirror of profiles.branch_sport for permission-time scoping';

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT COUNT(*) AS sport_catalog_rows FROM academy_sports;
-- SELECT COUNT(*) AS branch_rows        FROM sport_branches;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name LIKE 'branch%';
