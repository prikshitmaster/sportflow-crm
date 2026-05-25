-- 0080 — Delegate staff creation to staff.manage (safe, no privilege escalation)
--
-- WHY
--   'Manage Staff' (staff.manage) was a real permission an owner could grant,
--   but secure_insert_staff + secure_update_staff_permissions were owner-only,
--   so the grant did nothing — a delegated manager could only VIEW staff.
--
-- WHAT CHANGES (per "safe delegate" policy)
--   secure_insert_staff — now requires staff.manage (owners bypass via
--     _require_perm). Branch-scoped staff are forced into their own branch.
--   secure_update_staff_permissions — owners stay unrestricted. A non-owner
--     with staff.manage may set permissions ONLY when:
--       • the granted permissions are a non-empty subset of their OWN perms
--         (cannot escalate — e.g. a coach can't mint an admin), AND
--       • the target staff has no permissions yet (initial set on a freshly
--         created staff; editing an EXISTING staff's access stays owner-only).
--   secure_delete_staff — unchanged (still owner-only).
--
-- Signatures and return types are UNCHANGED. IDEMPOTENT — safe to re-run.

BEGIN;

-- ── secure_insert_staff ───────────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_staff(
  p_token text, p_name text, p_role text, p_phone text DEFAULT ''::text,
  p_sports jsonb DEFAULT '[]'::jsonb, p_salary numeric DEFAULT 0,
  p_join_date date DEFAULT NULL::date, p_status text DEFAULT 'Active'::text,
  p_photo_url text DEFAULT NULL::text, p_staff_code text DEFAULT NULL::text,
  p_join_code text DEFAULT NULL::text, p_staff_type text DEFAULT 'coach'::text,
  p_branch_id uuid DEFAULT NULL::uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a           RECORD;
  v_staff_id  BIGINT;
  v_branch_id UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

  -- Branch-scoped staff may only create staff inside their own branch.
  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  INSERT INTO staff (
    name, role, phone, sports, salary, join_date, status,
    attendance, photo_url, academy_id, branch_id
  )
  VALUES (
    p_name,
    p_role,
    COALESCE(p_phone, ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    COALESCE(p_salary, 0),
    COALESCE(p_join_date, CURRENT_DATE),
    COALESCE(p_status, 'Active'),
    100,
    NULLIF(p_photo_url, ''),
    a.academy_id,
    v_branch_id
  )
  RETURNING id INTO v_staff_id;

  IF p_staff_code IS NOT NULL AND p_staff_code <> '' THEN
    INSERT INTO staff_auth (staff_id, staff_code, join_code, status, staff_type)
    VALUES (
      v_staff_id,
      upper(p_staff_code),
      upper(p_join_code),
      'pending',
      COALESCE(p_staff_type, 'coach')
    );
  END IF;

  RETURN v_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_insert_staff(text, text, text, text, jsonb, numeric, date, text, text, text, text, text, uuid) TO anon, authenticated;


-- ── secure_update_staff_permissions ───────────────────────
CREATE OR REPLACE FUNCTION secure_update_staff_permissions(
  p_staff_id bigint, p_access_role text, p_permissions jsonb, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_existing      JSONB;
  v_exceeds       BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT academy_id INTO v_staff_academy FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy permission edit' USING ERRCODE = '42501';
  END IF;

  -- Non-owners: capped, initial-set-only delegation.
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

    -- Must grant at least one permission (prevents an empty grant from falling
    -- back to a broad role preset at login time).
    IF p_permissions IS NULL OR jsonb_array_length(p_permissions) = 0 THEN
      RAISE EXCEPTION 'forbidden: select at least one permission to grant access' USING ERRCODE = '42501';
    END IF;

    -- Escalation guard: every granted permission must be one the caller holds.
    SELECT bool_or(elem NOT IN (
             SELECT jsonb_array_elements_text(COALESCE(a.perms, '[]'::jsonb))
           ))
      INTO v_exceeds
      FROM jsonb_array_elements_text(p_permissions) elem;
    IF COALESCE(v_exceeds, false) THEN
      RAISE EXCEPTION 'forbidden: cannot grant permissions beyond your own' USING ERRCODE = '42501';
    END IF;

    -- Initial-set only: cannot change an existing staff's access.
    SELECT permissions INTO v_existing FROM staff_auth WHERE staff_id = p_staff_id;
    IF v_existing IS NOT NULL AND jsonb_array_length(v_existing) > 0 THEN
      RAISE EXCEPTION 'forbidden: only academy owners can change an existing staff''s access' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE staff_auth SET
    access_role = p_access_role,
    permissions = p_permissions
  WHERE staff_id = p_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_update_staff_permissions(bigint, text, jsonb, text) TO anon, authenticated;

COMMIT;
