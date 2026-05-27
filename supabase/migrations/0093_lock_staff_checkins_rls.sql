-- 0093 — Lock staff_checkins RLS
--
-- Migration 0085 created staff_checkins with USING (true) — wide open.
-- This replaces it with scoped policies matching the v3.0 pattern:
--   owners see their academy via JWT, staff see their academy via x-staff-token header.
--
-- IDEMPOTENT.

BEGIN;

-- Drop the wide-open policy
DROP POLICY IF EXISTS "checkins_read" ON staff_checkins;

-- Owner: read own academy's check-ins via JWT
DROP POLICY IF EXISTS "checkins_owner_read" ON staff_checkins;
CREATE POLICY "checkins_owner_read" ON staff_checkins
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

-- Staff: read own academy's check-ins via x-staff-token header
DROP POLICY IF EXISTS "checkins_staff_read" ON staff_checkins;
CREATE POLICY "checkins_staff_read" ON staff_checkins
  FOR SELECT TO anon
  USING (academy_id = current_staff_academy());

COMMIT;
