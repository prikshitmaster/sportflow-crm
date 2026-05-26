-- ============================================================
-- 0092 — secure_reset_staff_account RPC
-- ============================================================
-- WHY
--   If a staff account ends up in a broken state (status=active
--   but no email / no password), the owner needs a way to reset
--   it back to 'pending' with a fresh join_code so the staff member
--   can go through the normal activation flow again.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_reset_staff_account(
  p_staff_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          RECORD;
  v_academy  UUID;
  v_new_code TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token);
  IF a.actor_kind <> 'owner' THEN
    RAISE EXCEPTION 'Only academy owners can reset staff accounts' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_academy FROM staff WHERE id = p_staff_id;
  IF v_academy <> a.academy_id THEN
    RAISE EXCEPTION 'Staff not in your academy' USING ERRCODE = '42501';
  END IF;

  v_new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  UPDATE staff_auth SET
    status        = 'pending',
    join_code     = v_new_code,
    email         = NULL,
    password_hash = NULL
  WHERE staff_id = p_staff_id;

  RETURN json_build_object('joinCode', v_new_code);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_reset_staff_account(BIGINT, TEXT) TO anon, authenticated;
