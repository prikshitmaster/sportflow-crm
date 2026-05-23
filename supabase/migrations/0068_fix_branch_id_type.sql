-- 0068 — Fix p_branch_id type: sport_branches.id is UUID not BIGINT
-- Recreate assign/unassign with correct UUID type for p_branch_id.

BEGIN;

-- Drop old BIGINT-typed versions
DROP FUNCTION IF EXISTS secure_assign_branch_manager(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS secure_unassign_branch_manager(BIGINT, TEXT);

-- ════════════════════════════════════════════════════════════
-- secure_assign_branch_manager  (p_branch_id is UUID)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_assign_branch_manager(
  p_branch_id UUID,
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

  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: branch not in academy' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff_id AND academy_id = a.academy_id) THEN
    RAISE EXCEPTION 'forbidden: staff not in academy' USING ERRCODE = '42501';
  END IF;

  UPDATE sport_branches SET manager_id = p_staff_id WHERE id = p_branch_id;
  UPDATE staff SET branch_id = p_branch_id WHERE id = p_staff_id;

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
GRANT EXECUTE ON FUNCTION secure_assign_branch_manager(UUID, BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- secure_unassign_branch_manager  (p_branch_id is UUID)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_unassign_branch_manager(
  p_branch_id UUID,
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

  UPDATE sport_branches SET manager_id = NULL WHERE id = p_branch_id;

  IF v_staff IS NOT NULL THEN
    UPDATE staff_auth
       SET access_role = 'coach',
           permissions = '[]'::JSONB
     WHERE staff_id = v_staff;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_unassign_branch_manager(UUID, TEXT) TO anon, authenticated;

COMMIT;
