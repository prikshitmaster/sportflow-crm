-- ============================================================
-- 0091 — Return staff name from secure_verify_staff_codes
-- ============================================================
-- WHY
--   The activation page (StaffActivate.jsx) verifies staff_code +
--   join_code but never shows WHICH person's account is being
--   activated. If an owner sends the wrong link, the staff member
--   unknowingly activates someone else's account.
--   This migration updates secure_verify_staff_codes to return the
--   staff name so the UI can display a confirmation: "Activating
--   account for: Rohit Kapoor — is that you?"
--
-- CHANGE
--   secure_verify_staff_codes now returns JSON { name TEXT }
--   (was VOID). Existing error behaviour is unchanged.
-- ============================================================

DROP FUNCTION IF EXISTS secure_verify_staff_codes(TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_verify_staff_codes(
  p_staff_code TEXT,
  p_join_code  TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth   staff_auth%ROWTYPE;
  v_staff  staff%ROWTYPE;
BEGIN
  SELECT * INTO v_auth
  FROM staff_auth
  WHERE staff_code = upper(p_staff_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff ID not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_auth.status = 'active' THEN
    RAISE EXCEPTION 'Account already activated — go to login.' USING ERRCODE = '23505';
  END IF;
  IF v_auth.join_code IS DISTINCT FROM upper(p_join_code) THEN
    RAISE EXCEPTION 'Incorrect Join Code' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id LIMIT 1;

  RETURN json_build_object('name', COALESCE(v_staff.name, ''));
END;
$$;

GRANT EXECUTE ON FUNCTION secure_verify_staff_codes(TEXT, TEXT) TO anon, authenticated;
