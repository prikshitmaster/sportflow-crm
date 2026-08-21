-- 0173 — Allow staff.sports to be edited (multi-sport counter staff)
--
-- WHY: a branch that runs several sports (badminton, football, …) usually has
-- ONE front-desk person handling fees + admissions for all of them. The data
-- model already supports that — staff.sports is text[], and
-- current_staff_sports() (security-v3/12) normalises an empty array to NULL =
-- "see ALL sports", mirroring the branch_id IS NULL = "all branches" rule.
--
-- What was missing is a way to WRITE more than one sport: sports could only be
-- set at creation (secure_insert_staff / p_sports) and never changed after,
-- because secure_update_staff_profile's payload allowlist covered only
-- name/phone/photoUrl/age/licenceUrl. So covering two sports meant two staff
-- accounts and logging out to switch.
--
-- This adds a 'sports' key to that payload.
--
-- SECURITY — sports is NOT a self-service profile field:
-- changing it widens what rows a staff member can READ (RLS keys on
-- current_staff_sports()). So unlike name/phone/photo, it always requires
-- staff.manage plus academy + branch scope, even when the caller is editing
-- their OWN row. Without that guard any coach could self-assign every sport.
-- Owners keep the same same-academy check enforced above.
--
-- It is also capped to the caller's OWN sports, mirroring the no-escalation
-- rule already applied to permissions (0081/0083): a staff caller covering
-- ['Badminton'] cannot hand out 'Football', nor the empty array (= all
-- sports), to anyone — including themselves. A caller whose own sports is
-- empty already means "all sports", so they are unrestricted. Owners are
-- unrestricted.
--
-- Everything else about the function is unchanged from 0083. IDEMPOTENT.

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
  v_sports        TEXT[];
  v_caller_sports TEXT[];
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

  -- ── sports (scope-widening — see SECURITY note in the header) ──────────
  IF p_payload ? 'sports' THEN
    IF a.actor_kind = 'staff' THEN
      -- Re-checked unconditionally: the branch-manager block above is skipped
      -- entirely on the self-edit path, which must NOT be a way to grant
      -- yourself extra sports.
      PERFORM _require_perm(a.actor_kind, a.perms, 'staff.manage');
      IF v_staff_academy IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_staff_branch);
    END IF;

    IF jsonb_typeof(p_payload->'sports') <> 'array' THEN
      RAISE EXCEPTION 'sports must be a JSON array' USING ERRCODE = '22023';
    END IF;

    -- Empty array is meaningful: it stores '{}', which current_staff_sports()
    -- reads as "all sports at this branch".
    v_sports := ARRAY(
      SELECT btrim(x)
      FROM jsonb_array_elements_text(p_payload->'sports') AS t(x)
      WHERE btrim(x) <> ''
    );

    -- No-escalation cap (see header). Only applies to staff callers who are
    -- themselves restricted to a specific set of sports.
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

-- ════════════════════════════════════════════════════════════════
-- secure_insert_staff — same no-escalation cap on p_sports
--
-- Without this the cap above is trivially bypassed: a restricted caller could
-- just CREATE an account carrying sports they don't cover instead of editing
-- one. Mirrors the permissions guard already in secure_update_staff_permissions
-- ("cannot grant permissions beyond your own", security-v3/19).
--
-- Body copied verbatim from security-v3/19 with only the guard added.
-- Signature UNCHANGED.
-- ════════════════════════════════════════════════════════════════
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
  a               RECORD;
  v_staff_id      BIGINT;
  v_branch_id     UUID;
  v_sports        TEXT[];
  v_caller_sports TEXT[];
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

  -- Branch is mandatory (no all-branch staff).
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before adding staff'
      USING ERRCODE = '23502';
  END IF;

  v_sports := ARRAY(
    SELECT btrim(x)
    FROM jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB)) AS t(x)
    WHERE btrim(x) <> ''
  );

  -- No-escalation cap: a staff caller restricted to specific sports may not
  -- create someone covering a sport they don't, nor "all sports" (empty).
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

  INSERT INTO staff (
    name, role, phone, sports, salary, join_date, status,
    attendance, photo_url, academy_id, branch_id
  )
  VALUES (
    p_name,
    p_role,
    COALESCE(p_phone, ''),
    v_sports,
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

COMMIT;
