-- security-v3 / Phase 4-A — branch + sport read helpers (NO policy change yet)
--
-- Mirrors current_staff_academy(): reads the x-staff-token request header and
-- resolves the calling staff member's branch and sports. These are the building
-- blocks for branch/sport-aware RLS in Phase B+. Creating them changes NOTHING
-- about access — they're only wired into read policies in later phases.
--
-- Convention used by the planned policies:
--   • current_staff_branch()  IS NULL  → office/multi-branch staff → see ALL branches
--   • current_staff_sports()  IS NULL  → no-sport staff           → see ALL sports
-- so an empty sports array is normalised to NULL (= "all sports"), not "none".

BEGIN;

-- ════════════════════════════════════════════════════════════
-- current_staff_branch() → the caller's branch_id (NULL = all branches)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION current_staff_branch()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.branch_id
    FROM staff s
    JOIN staff_sessions ss ON ss.staff_id = s.id
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION current_staff_branch() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- current_staff_sports() → the caller's sports[] (NULL = all sports)
-- empty array is normalised to NULL so the "no sports = see all" rule holds.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION current_staff_sports()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN COALESCE(array_length(s.sports, 1), 0) = 0 THEN NULL ELSE s.sports END
    FROM staff s
    JOIN staff_sessions ss ON ss.staff_id = s.id
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION current_staff_sports() TO anon, authenticated;

COMMIT;
