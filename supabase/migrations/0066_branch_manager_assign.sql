-- 0066 — Branch manager assignment + permission grant (atomic)
--
-- Assigning a staff as branch manager does 4 things atomically:
--   1. sport_branches.manager_id  ← staff_id
--   2. staff.branch_id            ← branch_id        (scope their data to this branch)
--   3. staff_auth.access_role     ← 'branch_manager' (UI label)
--   4. staff_auth.permissions     ← full perm list   (mini-owner inside their branch)
--
-- Unassigning reverses #3 and #4 (demotes to 'coach' with empty perms) and clears #1.
-- #2 (staff.branch_id) is left as-is so the staff can still log in and see something.

BEGIN;

-- ════════════════════════════════════════════════════════════
-- secure_assign_branch_manager
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_assign_branch_manager(
  p_branch_id BIGINT,
  p_staff_id  BIGINT,
  p_token     TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_acad  UUID;
  v_perms JSONB := '[
    "dashboard.view","students.view","students.manage","attendance.manage",
    "payments.view","payments.manage","trials.manage","batches.view","batches.manage",
    "reports.view","staff.manage","settings.manage","community.manage","events.manage"
  ]'::JSONB;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Branch must exist and belong to this academy
  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: branch not in academy' USING ERRCODE = '42501';
  END IF;

  -- Staff must exist and belong to same academy
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff_id AND academy_id = a.academy_id) THEN
    RAISE EXCEPTION 'forbidden: staff not in academy' USING ERRCODE = '42501';
  END IF;

  -- 1. Link branch → manager
  UPDATE sport_branches SET manager_id = p_staff_id WHERE id = p_branch_id;

  -- 2. Lock the staff member to this branch
  UPDATE staff SET branch_id = p_branch_id WHERE id = p_staff_id;

  -- 3 + 4. Promote role + grant all perms in staff_auth.
  --        If staff_auth row doesn't exist yet (rare — staff added but not activated),
  --        create a stub so the perm grant lands somewhere.
  IF EXISTS (SELECT 1 FROM staff_auth WHERE staff_id = p_staff_id) THEN
    UPDATE staff_auth
       SET access_role = 'branch_manager',
           permissions = v_perms
     WHERE staff_id = p_staff_id;
  ELSE
    INSERT INTO staff_auth (staff_id, staff_code, status, staff_type, access_role, permissions)
    VALUES (
      p_staff_id,
      'FC' || lpad(p_staff_id::TEXT, 4, '0'),
      'pending',
      'coach',
      'branch_manager',
      v_perms
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_assign_branch_manager(BIGINT, BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- secure_unassign_branch_manager
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_unassign_branch_manager(
  p_branch_id BIGINT,
  p_token     TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a        RECORD;
  v_acad   UUID;
  v_staff  BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, manager_id INTO v_acad, v_staff
    FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: branch not in academy' USING ERRCODE = '42501';
  END IF;

  -- Clear branch ↔ manager link
  UPDATE sport_branches SET manager_id = NULL WHERE id = p_branch_id;

  -- Demote that staff back to a plain coach with no perms
  IF v_staff IS NOT NULL THEN
    UPDATE staff_auth
       SET access_role = 'coach',
           permissions = '[]'::JSONB
     WHERE staff_id = v_staff;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_unassign_branch_manager(BIGINT, TEXT) TO anon, authenticated;

COMMIT;
