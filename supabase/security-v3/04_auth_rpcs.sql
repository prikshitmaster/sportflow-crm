-- security-v3 / 04 — Auth RPCs (login + session validation + pre-activation verify)
--
-- WHY
--   Today, login flows do direct anon SELECT on staff_auth, staff, students,
--   staff_sessions, student_sessions. They also do direct anon INSERT into
--   staff_sessions / student_sessions. This means anon SELECT cannot be
--   locked down on these tables without breaking login. This migration
--   wraps every pre-auth read/write in a SECURITY DEFINER RPC so Phase 3
--   can drop the wide-open anon policies.
--
-- RPCs ADDED
--   secure_login_staff(email, password_hash)            → returns JSON bundle
--   secure_login_student(student_code, password_hash)   → returns JSON bundle
--   secure_validate_staff_session(token)                → returns JSON or NULL
--   secure_validate_student_session(token)              → returns JSON or NULL
--   secure_verify_staff_codes(staff_code, join_code)    → returns pre-activation status
--
-- TOKEN GENERATION
--   Server-side via encode(gen_random_bytes(32), 'hex') — matches the existing
--   client-side format (64-char hex). Stored verbatim in staff_sessions/student_sessions.
--
-- ERROR MODEL
--   - Invalid credentials: RAISE EXCEPTION with generic message (no info leak about
--     which field was wrong). Activation status errors still distinguishable.
--   - Expired/missing session: RPCs return NULL (caller falls back to anonymous).
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- secure_login_staff  (replaces loginStaffAccount + createStaffSession)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_login_staff(
  p_email         TEXT,
  p_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth     staff_auth%ROWTYPE;
  v_staff    staff%ROWTYPE;
  v_token    TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF p_email IS NULL OR p_password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_auth
  FROM staff_auth
  WHERE email = lower(trim(p_email))
    AND password_hash = p_password_hash
    AND status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff record not found' USING ERRCODE = 'P0002';
  END IF;

  -- 64 hex chars (matches client's old crypto.getRandomValues format).
  -- gen_random_uuid() is in pg_catalog and always reachable; gen_random_bytes
  -- requires the extensions schema on search_path which we don't set.
  v_token   := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
  v_expires := now() + interval '30 days';

  INSERT INTO staff_sessions (staff_id, token, expires_at)
  VALUES (v_staff.id, v_token, v_expires);

  -- Merge token + expires + auth columns + full staff row.
  -- row_to_json(v_staff) covers any column the client might consume.
  RETURN jsonb_build_object(
    'token',          v_token,
    'expires_at',     v_expires,
    'staff_code',     v_auth.staff_code,
    'staff_type',     COALESCE(v_auth.staff_type, 'coach'),
    'account_status', v_auth.status,
    'access_role',    COALESCE(v_auth.access_role, 'coach'),
    'permissions',    COALESCE(v_auth.permissions, '[]'::jsonb)
  ) || to_jsonb(v_staff);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_login_staff(TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_login_student  (replaces loginStudentAccount + createStudentSession)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_login_student(
  p_student_code  TEXT,
  p_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student students%ROWTYPE;
  v_token   TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_student_code IS NULL OR p_password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid Student ID or password' USING ERRCODE = '42501';
  END IF;

  -- Pre-check: does the student code exist at all? (give clearer error if not activated)
  SELECT * INTO v_student
  FROM students
  WHERE student_code = upper(trim(p_student_code))
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid Student ID or password' USING ERRCODE = '42501';
  END IF;
  IF v_student.account_status IS DISTINCT FROM 'active' OR v_student.password_hash IS NULL THEN
    RAISE EXCEPTION 'Account not activated yet — please go to "Activate your account" first' USING ERRCODE = '42501';
  END IF;
  IF v_student.password_hash IS DISTINCT FROM p_password_hash THEN
    RAISE EXCEPTION 'Invalid Student ID or password' USING ERRCODE = '42501';
  END IF;

  -- 64 hex chars (matches client's old crypto.getRandomValues format).
  -- gen_random_uuid() is in pg_catalog and always reachable; gen_random_bytes
  -- requires the extensions schema on search_path which we don't set.
  v_token   := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
  v_expires := now() + interval '30 days';

  INSERT INTO student_sessions (student_id, token, expires_at)
  VALUES (v_student.id, v_token, v_expires);

  -- Merge token + full student row. The student row IS the user object
  -- downstream, so include every column (sport, batch, branch_id, dob,
  -- height_cm, etc.).
  RETURN jsonb_build_object(
    'token',      v_token,
    'expires_at', v_expires
  ) || to_jsonb(v_student);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_login_student(TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_validate_staff_session  (replaces validateStaffSession on app boot)
-- Returns NULL when the token is missing/expired (no exception).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_validate_staff_session(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session  staff_sessions%ROWTYPE;
  v_staff    staff%ROWTYPE;
  v_auth     staff_auth%ROWTYPE;
  v_extra    staff_profiles%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_session
  FROM staff_sessions
  WHERE token = p_token
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_staff FROM staff WHERE id = v_session.staff_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_auth  FROM staff_auth     WHERE staff_id = v_staff.id LIMIT 1;
  SELECT * INTO v_extra FROM staff_profiles WHERE staff_id = v_staff.id LIMIT 1;

  RETURN jsonb_build_object(
    'staff_code',     v_auth.staff_code,
    'staff_type',     COALESCE(v_auth.staff_type, 'coach'),
    'account_status', v_auth.status,
    'access_role',    COALESCE(v_auth.access_role, 'coach'),
    'permissions',    COALESCE(v_auth.permissions, '[]'::jsonb),
    'age',            v_extra.age,
    'licence_url',    v_extra.licence_url
  ) || to_jsonb(v_staff);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_validate_staff_session(TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_validate_student_session  (replaces validateStudentSession)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_validate_student_session(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session student_sessions%ROWTYPE;
  v_student students%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_session
  FROM student_sessions
  WHERE token = p_token
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_student FROM students WHERE id = v_session.student_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN row_to_json(v_student);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_validate_student_session(TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_verify_staff_codes  (replaces verifyStaffCodes pre-activation step)
-- Used on /staff-activate step 1: enter staff_code + join_code → next step.
-- Doesn't return staff data — only validates the join_code is correct and
-- the account is still in 'pending' state.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_verify_staff_codes(
  p_staff_code TEXT,
  p_join_code  TEXT
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_auth staff_auth%ROWTYPE;
BEGIN
  SELECT * INTO v_auth FROM staff_auth WHERE staff_code = upper(trim(p_staff_code)) LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff ID not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_auth.status = 'active' THEN
    RAISE EXCEPTION 'Account already activated — go to login.' USING ERRCODE = '42501';
  END IF;
  IF v_auth.join_code IS DISTINCT FROM upper(trim(p_join_code)) THEN
    RAISE EXCEPTION 'Incorrect Join Code' USING ERRCODE = '42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_verify_staff_codes(TEXT, TEXT) TO anon, authenticated;

COMMIT;
