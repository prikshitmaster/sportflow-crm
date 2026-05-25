-- 0083 — Branch managers may edit staff profiles in their own branch
--
-- secure_update_staff_profile allowed only the owner (any staff in academy) or a
-- staff editing THEIR OWN profile. Now that branch managers manage their branch's
-- staff (0081), they also need to edit those staff's profile (name/phone/photo/age)
-- — e.g. attaching a photo to a staff they just created.
--
-- Branch managers are limited to their own branch (_require_branch_scope). Other
-- staff.manage holders still may only edit their own profile. Owners unchanged.
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_update_staff_profile(
  p_staff_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_staff_academy UUID;
  v_staff_branch  UUID;
  v_caller_role   TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_staff_academy, v_staff_branch
  FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'staff' THEN
    IF a.actor_id IS DISTINCT FROM p_staff_id THEN
      -- Editing someone else: only branch managers, within their own branch.
      SELECT access_role INTO v_caller_role FROM staff_auth WHERE staff_id = a.actor_id;
      IF COALESCE(v_caller_role, '') <> 'branch_manager' THEN
        RAISE EXCEPTION 'forbidden: staff can only update their own profile' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch);
    END IF;
  ELSE
    -- owner: must be same academy
    IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_payload ? 'name' OR p_payload ? 'phone' OR p_payload ? 'photoUrl' THEN
    UPDATE staff SET
      name      = CASE WHEN p_payload ? 'name'     THEN COALESCE(NULLIF(p_payload->>'name',''), name)  ELSE name      END,
      phone     = CASE WHEN p_payload ? 'phone'    THEN COALESCE(p_payload->>'phone', '')               ELSE phone     END,
      photo_url = CASE WHEN p_payload ? 'photoUrl' THEN NULLIF(p_payload->>'photoUrl','')               ELSE photo_url END
    WHERE id = p_staff_id;
  END IF;

  IF p_payload ? 'age' OR p_payload ? 'licenceUrl' THEN
    INSERT INTO staff_profiles (staff_id, age, licence_url, updated_at)
    VALUES (
      p_staff_id,
      NULLIF(p_payload->>'age','')::INT,
      NULLIF(p_payload->>'licenceUrl',''),
      now()
    )
    ON CONFLICT (staff_id) DO UPDATE SET
      age         = CASE WHEN p_payload ? 'age'        THEN NULLIF(p_payload->>'age','')::INT   ELSE staff_profiles.age         END,
      licence_url = CASE WHEN p_payload ? 'licenceUrl' THEN NULLIF(p_payload->>'licenceUrl','') ELSE staff_profiles.licence_url END,
      updated_at  = now();
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_update_staff_profile(bigint, jsonb, text) TO anon, authenticated;

COMMIT;
