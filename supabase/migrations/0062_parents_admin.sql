-- 0062: Parents admin page support
-- Adds two RPCs:
--   secure_get_parent_detail — parent + children + payment status, for the
--     admin detail modal. Owner or staff (any non-student actor).
--   secure_update_parent      — owner edits name/phone/email of a parent row.
-- IDEMPOTENT — safe to re-run.

-- ════════════════════════════════════════════════════════════
-- Get one parent + linked children + payment + claim status
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_get_parent_detail(
  p_parent_id UUID,
  p_token     TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_par   parents%ROWTYPE;
  v_kids  JSON;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_par FROM parents WHERE id = p_parent_id;
  IF v_par.id IS NULL OR v_par.academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'parent not found in this academy' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(json_agg(child ORDER BY child->>'name'), '[]'::json) INTO v_kids
  FROM (
    SELECT json_build_object(
      'id',            s.id,
      'name',          s.name,
      'student_code',  s.student_code,
      'sport',         s.sport,
      'batch',         s.batch,
      'photo_url',     s.photo_url,
      'status',        s.status,
      'fees',          s.fees,
      'fee_plan',      s.fee_plan,
      'paid_till',     s.paid_till,
      'relationship',  ps.relationship,
      'is_primary',    ps.is_primary
    ) AS child
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = p_parent_id
  ) t;

  RETURN json_build_object(
    'parent', json_build_object(
      'id',            v_par.id,
      'name',          v_par.name,
      'phone',         v_par.phone,
      'email',         v_par.email,
      'claimed',       v_par.auth_user_id IS NOT NULL,
      'created_at',    v_par.created_at,
      'updated_at',    v_par.updated_at
    ),
    'children', v_kids
  );
END;
$$;
GRANT EXECUTE ON FUNCTION secure_get_parent_detail(UUID, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- Update parent (owner only). Phone change re-keys on (academy_id, phone).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_update_parent(
  p_parent_id UUID,
  p_payload   JSONB,
  p_token     TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_acad  UUID;
  v_row   parents%ROWTYPE;
  v_phone TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only owner can edit parents' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_acad FROM parents WHERE id = p_parent_id;
  IF v_acad IS NULL OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'parent not found in this academy' USING ERRCODE = '42501';
  END IF;

  -- Normalize phone if provided (keep only last 10 digits, must be 10)
  IF p_payload ? 'phone' THEN
    v_phone := right(regexp_replace(p_payload->>'phone', '\D', '', 'g'), 10);
    IF length(v_phone) <> 10 THEN
      RAISE EXCEPTION 'phone must be 10 digits' USING ERRCODE = '22023';
    END IF;
    -- Reject if another parent in this academy already has that phone
    IF EXISTS (
      SELECT 1 FROM parents
       WHERE academy_id = a.academy_id
         AND phone      = v_phone
         AND id         <> p_parent_id
    ) THEN
      RAISE EXCEPTION 'another parent in this academy already uses that phone'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE parents SET
    name       = CASE WHEN p_payload ? 'name'  THEN p_payload->>'name'                ELSE name  END,
    phone      = CASE WHEN p_payload ? 'phone' THEN v_phone                           ELSE phone END,
    email      = CASE WHEN p_payload ? 'email' THEN NULLIF(p_payload->>'email','')    ELSE email END,
    updated_at = NOW()
  WHERE id = p_parent_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_parent(UUID, JSONB, TEXT) TO anon, authenticated;
