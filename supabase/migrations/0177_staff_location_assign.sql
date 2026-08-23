-- 0177 — Phase 5: let an owner (or a branch manager) assign staff.location_id
--
-- 0175/0176 made location scope work for reads and writes; this is the only way
-- to actually SET it. Extends secure_update_staff_profile's payload with a
-- 'locationId' key, alongside the 'sports' key added in 0173.
--
--   locationId: "<uuid>"  → whole-branch scope: every sport at that place
--   locationId: null      → clear it, back to single sport-branch pinning
--
-- SECURITY — same reasoning as 'sports': this widens what the staff member can
-- see and write, so it is never a self-service field. It requires staff.manage
-- plus academy and branch scope, even when editing your own row.
--
-- NO-ESCALATION CAP: a staff caller may only hand out the location they are
-- themselves inside — their own location_id if they have one, otherwise the
-- location of their own branch. So a manager at ARA SG Highway can appoint a
-- counter person for ARA SG Highway and nowhere else. Owners are unrestricted
-- within their academy.
--
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_update_staff_profile(
  p_staff_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a                RECORD;
  v_staff_academy  UUID;
  v_staff_branch   UUID;
  v_caller_role    TEXT;
  v_sports         TEXT[];
  v_caller_sports  TEXT[];
  v_location       UUID;
  v_loc_academy    UUID;
  v_caller_loc     UUID;
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
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);
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

  -- ── sports (scope-narrowing — see 0173) ───────────────────────────────
  IF p_payload ? 'sports' THEN
    IF a.actor_kind = 'staff' THEN
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);
    END IF;

    IF jsonb_typeof(p_payload->'sports') <> 'array' THEN
      RAISE EXCEPTION 'sports must be a JSON array' USING ERRCODE = '22023';
    END IF;

    v_sports := ARRAY(
      SELECT btrim(x)
      FROM jsonb_array_elements_text(p_payload->'sports') AS t(x)
      WHERE btrim(x) <> ''
    );

    IF a.actor_kind = 'staff' THEN
      SELECT sports INTO v_caller_sports FROM staff WHERE id = a.actor_id;
      IF COALESCE(array_length(v_caller_sports, 1), 0) > 0 THEN
        IF COALESCE(array_length(v_sports, 1), 0) = 0 THEN
          RAISE EXCEPTION 'forbidden: cannot grant all sports beyond your own'
            USING ERRCODE = '42501';
        END IF;
        IF EXISTS (
          SELECT 1 FROM unnest(v_sports) AS want
          WHERE lower(want) NOT IN (SELECT lower(mine) FROM unnest(v_caller_sports) AS mine)
        ) THEN
          RAISE EXCEPTION 'forbidden: cannot grant a sport you do not cover'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    UPDATE staff SET sports = v_sports WHERE id = p_staff_id;
  END IF;

  -- ── locationId (scope-WIDENING — the counter-staff switch) ────────────
  IF p_payload ? 'locationId' THEN
    IF a.actor_kind = 'staff' THEN
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch, a.actor_id);
    END IF;

    v_location := NULLIF(p_payload->>'locationId', '')::uuid;

    IF v_location IS NOT NULL THEN
      SELECT academy_id INTO v_loc_academy FROM locations WHERE id = v_location;
      IF v_loc_academy IS NULL THEN
        RAISE EXCEPTION 'location not found' USING ERRCODE = 'P0002';
      END IF;
      -- A location from another academy would silently cross the tenant line.
      IF v_loc_academy IS DISTINCT FROM v_staff_academy THEN
        RAISE EXCEPTION 'forbidden: location belongs to another academy' USING ERRCODE = '42501';
      END IF;

      -- No-escalation cap: only a caller who ALREADY has whole-branch scope may
      -- grant it, and only for their own place. Deliberately reads
      -- s.location_id and does NOT fall back to the branch's location — a
      -- cricket-pinned manager must not be able to mint someone who sees
      -- football, which is access they do not themselves hold.
      IF a.actor_kind = 'staff' THEN
        SELECT s.location_id INTO v_caller_loc FROM staff s WHERE s.id = a.actor_id;
        IF v_caller_loc IS NULL OR v_caller_loc IS DISTINCT FROM v_location THEN
          RAISE EXCEPTION 'forbidden: cannot grant a branch you do not manage'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    UPDATE staff SET location_id = v_location WHERE id = p_staff_id;

    -- Whole-branch means every sport there, so a leftover sports[] would keep
    -- narrowing batches/trials/announcements and contradict the grant. Clearing
    -- it is a consequence of the (already capped) location grant, not a
    -- separate escalation.
    IF v_location IS NOT NULL THEN
      UPDATE staff SET sports = '{}' WHERE id = p_staff_id;
    END IF;
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
