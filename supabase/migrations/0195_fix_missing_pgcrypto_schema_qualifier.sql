-- 0195: fix a real, pre-existing production bug found while adversarially
-- testing 0194's payment-link fix — unrelated to branch isolation.
--
-- pgcrypto is installed in the `extensions` schema on this database, not
-- `public`. These 4 SECURITY DEFINER functions all pin
-- `SET search_path TO 'public'` and then call the unqualified
-- `gen_random_bytes(...)`, which pgcrypto provides — so every one of them
-- throws "function gen_random_bytes(integer) does not exist" whenever
-- called. Confirmed empirically: calling secure_create_payment_link for a
-- real, valid, same-branch student raised exactly this error.
--
-- Broken right now: Create Payment Link (Payments page), staff invite
-- creation (Settings > Staff), gate QR regenerate + get-or-create
-- (Attendance QR gate setup). Fix: schema-qualify the calls.

CREATE OR REPLACE FUNCTION public.secure_create_invite(p_name text, p_access_role text, p_permissions jsonb, p_academy_name text DEFAULT NULL::text, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_tok  TEXT;
  v_row  staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO staff_invites (token, academy_id, academy_name, name, access_role, permissions, expires_at, used)
  VALUES (v_tok, a.academy_id, COALESCE(p_academy_name,''), p_name, p_access_role,
          COALESCE(p_permissions,'[]'::JSONB), now() + INTERVAL '7 days', false)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_create_payment_link(p_student_id bigint, p_amount numeric, p_description text DEFAULT NULL::text, p_months integer DEFAULT 1, p_coverage_start date DEFAULT NULL::date, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a       RECORD;
  v_stud  RECORD;
  v_row   payment_links%ROWTYPE;
  v_code  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT id, academy_id, branch_id INTO v_stud FROM students WHERE id = p_student_id;
  IF v_stud.academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'student not found in this academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_stud.branch_id, a.actor_id);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = '22023';
  END IF;

  v_code := encode(extensions.gen_random_bytes(6), 'base64');
  v_code := translate(v_code, '+/=', 'AB_');

  INSERT INTO payment_links (
    academy_id, student_id, amount, description,
    months_covered, coverage_start, short_code, created_by
  ) VALUES (
    a.academy_id, p_student_id, p_amount, p_description,
    COALESCE(p_months, 1), p_coverage_start, v_code,
    COALESCE((SELECT name FROM profiles WHERE id = auth.uid()), 'Staff')
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_get_or_create_gate_qr(p_academy_name text DEFAULT 'Academy Gate'::text, p_token text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a         RECORD;
  v_row     gate_qr%ROWTYPE;
  v_tok     TEXT;
  v_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_branch := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch := a.branch_id;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Open a specific branch to view its gate QR' USING ERRCODE = '23502';
  END IF;

  IF a.actor_kind = 'staff' THEN
    IF NOT (a.perms ? 'attendance.manage') THEN
      RAISE EXCEPTION 'forbidden: missing attendance.manage permission' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM gate_qr
    WHERE academy_id = a.academy_id AND branch_id = v_branch
    ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate QR not set up for this branch yet — ask the academy owner' USING ERRCODE = 'P0002';
    END IF;
    RETURN row_to_json(v_row);
  END IF;

  IF a.actor_kind != 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM gate_qr
  WHERE academy_id = a.academy_id AND branch_id = v_branch
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN row_to_json(v_row); END IF;

  v_tok := encode(extensions.gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id, branch_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id, v_branch)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_regenerate_gate_qr(p_academy_name text DEFAULT 'Academy Gate'::text, p_token text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_row  gate_qr%ROWTYPE;
  v_tok  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage gate QR' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Open a specific branch to regenerate its gate QR' USING ERRCODE = '23502';
  END IF;

  DELETE FROM gate_qr WHERE academy_id = a.academy_id AND branch_id = p_branch_id;

  v_tok := encode(extensions.gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id, branch_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id, p_branch_id)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
