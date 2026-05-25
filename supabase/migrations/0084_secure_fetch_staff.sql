-- 0084 — Staff-portal-readable staff list (incl. access_role / permissions)
--
-- WHY
--   staff_auth is locked to anon (security-v3 phase 3), so the staff portal's
--   PostgREST join `staff(..., staff_auth(...))` returns NULL for staff_code,
--   access_role, permissions, etc. Result: in the staff portal every staff shows
--   as "Coach / no permissions / Staff ID —" regardless of their real role — and
--   a branch manager opening the Access tab would see empty data and could
--   overwrite real permissions on save.
--
-- WHAT
--   secure_fetch_staff(token) — SECURITY DEFINER, returns the academy's staff
--   joined with staff_auth + staff_profiles. Callable by owner or staff.
--   Sensitive fields (staff_code, join_code, account_status, access_role,
--   permissions) are returned ONLY to owners and staff who hold 'staff.manage';
--   everyone else gets the basic HR fields (name/role/phone/photo/sports/status)
--   needed for general display (e.g. batch coach names).
--
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_fetch_staff(p_token text DEFAULT NULL::text)
RETURNS SETOF json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_priv BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN RETURN; END IF;
  IF a.actor_kind NOT IN ('owner', 'staff') THEN RETURN; END IF;

  v_priv := (a.actor_kind = 'owner')
            OR (COALESCE(a.perms, '[]'::jsonb) ? 'staff.manage');

  RETURN QUERY
  SELECT row_to_json(t) FROM (
    SELECT
      s.id, s.name, s.role, s.phone, s.sports, s.salary,
      s.join_date, s.status, s.attendance, s.photo_url, s.user_id, s.branch_id,
      sa.staff_type AS staff_type,
      CASE WHEN v_priv THEN sa.staff_code  END AS staff_code,
      CASE WHEN v_priv THEN sa.join_code   END AS join_code,
      CASE WHEN v_priv THEN sa.status       END AS account_status,
      CASE WHEN v_priv THEN sa.access_role  END AS access_role,
      CASE WHEN v_priv THEN sa.permissions  END AS permissions,
      sp.age, sp.licence_url
    FROM staff s
    LEFT JOIN staff_auth     sa ON sa.staff_id = s.id
    LEFT JOIN staff_profiles sp ON sp.staff_id = s.id
    WHERE s.academy_id = a.academy_id
    ORDER BY s.name
  ) t;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_fetch_staff(text) TO anon, authenticated;

COMMIT;
