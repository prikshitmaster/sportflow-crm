-- ============================================================
-- 0078_staff_insert_branch.sql
--
-- Bug: secure_insert_staff didn't accept a branch_id, so every new
-- staff member was created with staff.branch_id = NULL. Because
-- AppContext's effectiveBranch reads from user.branchId for staff,
-- a NULL branch meant `hasBranchScope = false` and they could see
-- every student/batch in the whole academy — across all branches.
--
-- This migration extends the RPC with an optional p_branch_id
-- parameter. Existing callers continue to work (defaults to NULL).
-- ============================================================

-- Drop the previous 12-arg overload so PostgREST doesn't ambiguously
-- pick the old (branch-less) function when called from the client.
DROP FUNCTION IF EXISTS secure_insert_staff(
  text, text, text, text, jsonb, numeric, date, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION secure_insert_staff(
  p_token       TEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_phone       TEXT       DEFAULT '',
  p_sports      JSONB      DEFAULT '[]',
  p_salary      NUMERIC    DEFAULT 0,
  p_join_date   DATE       DEFAULT NULL,
  p_status      TEXT       DEFAULT 'Active',
  p_photo_url   TEXT       DEFAULT NULL,
  p_staff_code  TEXT       DEFAULT NULL,
  p_join_code   TEXT       DEFAULT NULL,
  p_staff_type  TEXT       DEFAULT 'coach',
  p_branch_id   UUID       DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          RECORD;
  v_staff_id BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can add staff'
      USING ERRCODE = '42501';
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
    p_branch_id
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
$$;

GRANT EXECUTE ON FUNCTION secure_insert_staff(
  TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO anon, authenticated;
