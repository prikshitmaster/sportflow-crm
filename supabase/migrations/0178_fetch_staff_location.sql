-- 0178 — secure_fetch_staff also returns location_id
--
-- Office staff and branch managers read the staff list through this RPC (the
-- anon key cannot read staff_auth directly), so without location_id in its
-- output the whole-branch scope set in 0177 would be invisible to them in the
-- Staff screen — they'd see an empty scope picker and could clear it by accident.
-- Owners use the PostgREST select('*') path and already had it.
--
-- Body is the live definition with `s.location_id` added to the SELECT list;
-- nothing else changed. IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_fetch_staff(p_token text DEFAULT NULL::text)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
      s.join_date, s.status, s.attendance, s.photo_url, s.user_id, s.branch_id, s.location_id,
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
$function$
;

COMMIT;
