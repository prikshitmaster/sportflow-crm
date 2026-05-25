-- 0081 — Branch managers may delete + edit existing staff (own branch only)
--
-- Refines 0080's "safe delegate":
--   • Owner            — full staff control, academy-wide (unchanged).
--   • Branch Manager   — may DELETE staff and EDIT an existing staff's access,
--                        but only for staff in their OWN branch.
--   • Other staff.manage holders — create-only with capped initial perms
--                        (cannot delete, cannot edit an existing staff's access).
--
-- "Branch Manager" = staff_auth.access_role = 'branch_manager'. Branch scope is
-- enforced via _require_branch_scope (a branch-scoped actor cannot touch another
-- branch's rows; owners bypass).
--
-- Signatures unchanged. IDEMPOTENT.

BEGIN;

-- ── secure_delete_staff ───────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_staff(
  p_staff_id bigint, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_target_academy UUID;
  v_target_branch  UUID;
  v_caller_role    TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_target_academy, v_target_branch
  FROM staff WHERE id = p_staff_id;
  IF v_target_academy IS NULL THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  -- Owner: unrestricted. Branch manager: own branch only. Anyone else: blocked.
  IF a.actor_kind <> 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
    SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
    IF COALESCE(v_caller_role, '') <> 'branch_manager' THEN
      RAISE EXCEPTION 'forbidden: only owners and branch managers can delete staff' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_target_branch);
  END IF;

  DELETE FROM leave_requests   WHERE staff_id   = p_staff_id;
  DELETE FROM staff_attendance WHERE profile_id = p_staff_id;
  DELETE FROM staff            WHERE id = p_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_delete_staff(bigint, text) TO anon, authenticated;


-- ── secure_update_staff_permissions ───────────────────────
CREATE OR REPLACE FUNCTION secure_update_staff_permissions(
  p_staff_id bigint, p_access_role text, p_permissions jsonb, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_staff_branch  UUID;
  v_existing      JSONB;
  v_caller_role   TEXT;
  v_exceeds       BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT academy_id, branch_id INTO v_staff_academy, v_staff_branch
  FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy permission edit' USING ERRCODE = '42501';
  END IF;

  -- Non-owners: capped + branch-scoped. Only branch managers may edit existing access.
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');

    -- Must grant at least one permission (an empty grant would fall back to a
    -- broad role preset at login time).
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

    -- Branch scope: cannot touch staff outside the caller's branch.
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch);

    -- Editing an EXISTING staff's access is reserved for owners + branch managers.
    SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
    SELECT permissions INTO v_existing     FROM staff_auth WHERE staff_id = p_staff_id;
    IF (v_existing IS NOT NULL AND jsonb_array_length(v_existing) > 0)
       AND COALESCE(v_caller_role, '') <> 'branch_manager' THEN
      RAISE EXCEPTION 'forbidden: only owners and branch managers can change an existing staff''s access' USING ERRCODE = '42501';
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
