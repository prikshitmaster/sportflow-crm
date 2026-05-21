-- 0059: Allow staff to read gate QR (not create/regenerate)
-- WHY: secure_get_or_create_gate_qr was owner-only, so coaches saw
--      "QR unavailable" on their dashboard. Staff with attendance.manage
--      permission now get a read-only path; only owners can create/regenerate.

CREATE OR REPLACE FUNCTION secure_get_or_create_gate_qr(
  p_academy_name TEXT    DEFAULT 'Academy Gate',
  p_token        TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a      RECORD;
  v_row  gate_qr%ROWTYPE;
  v_tok  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Staff with attendance.manage: read the existing QR, do not create
  IF a.actor_kind = 'staff' THEN
    IF NOT (a.perms ? 'attendance.manage') THEN
      RAISE EXCEPTION 'forbidden: missing attendance.manage permission' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM gate_qr
    WHERE academy_id = a.academy_id ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate QR not set up yet — ask the academy owner to enable it' USING ERRCODE = 'P0002';
    END IF;
    RETURN row_to_json(v_row);
  END IF;

  -- Owner: full get-or-create
  IF a.actor_kind != 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM gate_qr
  WHERE academy_id = a.academy_id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN row_to_json(v_row); END IF;

  v_tok := encode(gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_get_or_create_gate_qr(TEXT, TEXT) TO anon, authenticated;
