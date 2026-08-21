-- 0174 — Phase 1: a real "location" (physical branch) entity
--
-- WHY: sport_branches is a (sport × location) table, not a branch table.
-- "ARA SG Highway" exists as SIX rows with six different UUIDs — one per sport
-- run there. Because staff.branch_id points at exactly ONE of those rows, a
-- front-desk person at that location can only ever see one sport's students,
-- payments and batches. That is the real cause of "he has to log in again for
-- every sport" — staff.sports[] (0173) can only narrow WITHIN a branch row, it
-- can never widen past branch_id.
--
-- This migration only introduces the grouping. It changes NO behaviour:
--   • nothing reads locations yet
--   • staff.location_id is NULL for every existing row
-- Phases 2-5 build on it. Rollback is simply dropping the two columns and the
-- table (nothing depends on them yet).
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- locations — one row per physical place, grouping its sport rows
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT locations_academy_name_key UNIQUE (academy_id, name)
);

CREATE INDEX IF NOT EXISTS locations_academy_idx ON locations (academy_id);

-- Mirrors sport_branches' policies exactly (owner via get_my_academy_id, and
-- the anon/staff/student read path used by the app's session-header RLS).
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locations_access ON locations;
CREATE POLICY locations_access ON locations
  FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

DROP POLICY IF EXISTS locations_anon_read ON locations;
CREATE POLICY locations_anon_read ON locations
  FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());

-- ════════════════════════════════════════════════════════════════
-- Backfill: one location per distinct (academy_id, branch_name)
-- ════════════════════════════════════════════════════════════════
-- Address is picked from any one sport row that has one — the rows describe the
-- same physical place, so they should agree; where they don't, this is a
-- display-only field and the owner can correct it.
INSERT INTO locations (academy_id, name, address)
SELECT sb.academy_id,
       sb.branch_name,
       (ARRAY_REMOVE(ARRAY_AGG(NULLIF(btrim(sb.address), '')), NULL))[1]
  FROM sport_branches sb
 WHERE sb.branch_name IS NOT NULL AND btrim(sb.branch_name) <> ''
 GROUP BY sb.academy_id, sb.branch_name
ON CONFLICT (academy_id, name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Link sport_branches → locations
-- ════════════════════════════════════════════════════════════════
ALTER TABLE sport_branches ADD COLUMN IF NOT EXISTS location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sport_branches_location_id_fkey'
  ) THEN
    ALTER TABLE sport_branches
      ADD CONSTRAINT sport_branches_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE sport_branches sb
   SET location_id = l.id
  FROM locations l
 WHERE l.academy_id = sb.academy_id
   AND l.name       = sb.branch_name
   AND sb.location_id IS DISTINCT FROM l.id;

CREATE INDEX IF NOT EXISTS sport_branches_location_idx ON sport_branches (location_id);

-- ════════════════════════════════════════════════════════════════
-- staff.location_id — the opt-in scope switch
-- ════════════════════════════════════════════════════════════════
-- NULL (the default, and the value every existing row keeps) means "behave
-- exactly as today: pinned to branch_id". Only when this is set does a staff
-- member get whole-location scope. Nothing reads it until Phase 3.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_location_id_fkey'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS staff_location_idx ON staff (location_id);

COMMIT;
