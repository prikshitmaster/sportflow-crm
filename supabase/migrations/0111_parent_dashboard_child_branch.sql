-- 0106: expose each child's branch_id in the parent dashboard payload so the
-- parent portal can branch-filter announcements (branch isolation). Same body
-- as 0057's secure_get_parent_dashboard with 'branch_id' added per child.

CREATE OR REPLACE FUNCTION secure_get_parent_dashboard()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_parent  parents%ROWTYPE;
  v_kids    JSON;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_parent FROM parents WHERE auth_user_id = v_uid;
  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'parent account not claimed yet' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(json_agg(child ORDER BY child->>'name'), '[]'::json) INTO v_kids
  FROM (
    SELECT json_build_object(
      'id',             s.id,
      'name',           s.name,
      'student_code',   s.student_code,
      'sport',          s.sport,
      'batch',          s.batch,
      'photo_url',      s.photo_url,
      'status',         s.status,
      'fees',           s.fees,
      'paid_till',      s.paid_till,
      'fee_plan',       s.fee_plan,
      'branch_id',      s.branch_id,
      'relationship',   ps.relationship,
      'is_primary',     ps.is_primary
    ) AS child
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = v_parent.id
  ) t;

  RETURN json_build_object(
    'parent', row_to_json(v_parent),
    'children', v_kids
  );
END;
$$;
GRANT EXECUTE ON FUNCTION secure_get_parent_dashboard() TO authenticated;
