-- 0082 — Allow staff.manage to mint the next staff code
--
-- secure_fetch_next_staff_code was owner-only, but staff creation is now
-- delegated to staff.manage (0080). The Add Staff flow calls this read-only
-- code generator before insert, so a delegated manager hit
-- "forbidden: only owners can mint staff codes". Align it with secure_insert_staff.
--
-- Read-only (STABLE) — just computes the next sequential FC###/OF### code.
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_fetch_next_staff_code(p_type text, p_token text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a        RECORD;
  v_prefix TEXT;
  v_last   TEXT;
  v_num    INTEGER;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

  v_prefix := CASE WHEN p_type = 'office' THEN 'OF' ELSE 'FC' END;

  SELECT staff_code INTO v_last
  FROM staff_auth
  WHERE staff_code LIKE v_prefix || '%'
  ORDER BY staff_code DESC
  LIMIT 1;

  v_num := COALESCE(NULLIF(substring(v_last FROM length(v_prefix) + 1), '')::INTEGER, 0) + 1;
  RETURN v_prefix || lpad(v_num::TEXT, 3, '0');
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_fetch_next_staff_code(text, text) TO anon, authenticated;

COMMIT;
