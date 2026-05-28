-- 0095 — Feature flags owner RLS
--
-- feature_flags only had an anon-read policy (for staff/student portals).
-- Owners using JWT (authenticated role) had no write policy at all, so
-- toggling features in Settings threw "row-level security policy violation".
--
-- IDEMPOTENT.

BEGIN;

-- Owner: read own academy's flags via JWT
DROP POLICY IF EXISTS "feature_flags_owner_select" ON feature_flags;
CREATE POLICY "feature_flags_owner_select" ON feature_flags
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

-- Owner: insert / update own academy's flags via JWT
DROP POLICY IF EXISTS "feature_flags_owner_write" ON feature_flags;
CREATE POLICY "feature_flags_owner_write" ON feature_flags
  FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

COMMIT;
