-- security-v3 / 25 — Rate-limit staff + student login
--
-- Found by round-3 QA (2026-08-10): 8 rapid, back-to-back failed
-- secure_login_staff attempts against the same email all returned in the
-- same time with no slowdown, lockout, or CAPTCHA. Combined with the
-- password check being a single fast SHA-256 comparison against a global
-- salt (auth.js's own comment already flags this as a placeholder for a
-- real bcrypt/Argon2 upgrade), nothing stood between a known/guessed staff
-- email and unlimited password attempts at network speed.
--
-- Design:
--   • Keyed per login IDENTIFIER (email / student code), not per IP — an
--     attacker rotating source IPs gains nothing, and this needs no access
--     to request headers.
--   • 5 failures within a 15-minute window locks that identifier for 15
--     minutes. A success clears the counter immediately.
--   • The lockout produces the EXACT SAME response as a normal bad password
--     (RETURN NULL, which the client already turns into 'Invalid email or
--     password' / 'Invalid Student ID or password') — a distinct "too many
--     attempts" message would itself leak whether repeated guesses are
--     landing on a real account, since a nonexistent email/code never
--     accumulates failures differently from a real one under this design.
--   • The table is RLS-locked with no policies — only reachable through
--     these SECURITY DEFINER functions, same pattern as staff_sessions.
--
-- WHY RETURN NULL, NOT RAISE EXCEPTION, on a failed/locked attempt — first
-- version of this migration used RAISE EXCEPTION for both, which turned out
-- to silently defeat itself: PostgREST runs each RPC call as one
-- transaction, and an uncaught RAISE EXCEPTION aborts that whole
-- transaction — including the _login_record_failure() write that had just
-- run inside the SAME function call, one statement earlier. Every failure
-- was being recorded and then immediately un-recorded by its own error.
-- secure_login_staff/secure_login_student's callers in db.js already treat
-- a falsy `data` with no `error` as "Invalid email or password" (verified
-- against the current loginStaffAccount/loginStudentAccount bodies before
-- relying on it), so returning NULL is a no-op change for legitimate
-- callers and the fix that actually lets the counter persist.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_rate_limits (
  key          TEXT PRIMARY KEY,       -- 'staff:<email>' or 'student:<code>'
  fail_count   INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);
ALTER TABLE public.login_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies — anon/authenticated get zero direct access. SECURITY DEFINER
-- functions below bypass RLS entirely, which is the only intended access path.

CREATE OR REPLACE FUNCTION public._login_rate_limited(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT locked_until IS NOT NULL AND locked_until > now()
  FROM login_rate_limits WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION public._login_record_failure(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_max_attempts CONSTANT INT := 5;
  v_window       CONSTANT INTERVAL := interval '15 minutes';
  v_lockout      CONSTANT INTERVAL := interval '15 minutes';
  v_row login_rate_limits%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM login_rate_limits WHERE key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO login_rate_limits (key, fail_count, window_start) VALUES (p_key, 1, now());
    RETURN;
  END IF;

  IF v_row.window_start < now() - v_window THEN
    -- Previous window expired — start a fresh count instead of
    -- accumulating forever off a single stale attempt from hours ago.
    UPDATE login_rate_limits
       SET fail_count = 1, window_start = now(), locked_until = NULL
     WHERE key = p_key;
    RETURN;
  END IF;

  UPDATE login_rate_limits
     SET fail_count   = v_row.fail_count + 1,
         locked_until = CASE WHEN v_row.fail_count + 1 >= v_max_attempts
                              THEN now() + v_lockout ELSE locked_until END
   WHERE key = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION public._login_clear_failures(p_key TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM login_rate_limits WHERE key = p_key;
$$;

-- ════════════════════════════════════════════════════════════════
-- secure_login_staff — add the lockout check + failure/success hooks
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_login_staff(p_email text, p_password_hash text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_auth     staff_auth%ROWTYPE;
  v_staff    staff%ROWTYPE;
  v_extra    staff_profiles%ROWTYPE;
  v_token    TEXT;
  v_expires  TIMESTAMPTZ;
  v_key      TEXT;
BEGIN
  IF p_email IS NULL OR p_password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '42501';
  END IF;

  v_key := 'staff:' || lower(trim(p_email));
  IF _login_rate_limited(v_key) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_auth
  FROM staff_auth
  WHERE email = lower(trim(p_email))
    AND password_hash = p_password_hash
    AND status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    PERFORM _login_record_failure(v_key);
    RETURN NULL;
  END IF;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff record not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM _login_clear_failures(v_key);

  SELECT * INTO v_extra FROM staff_profiles WHERE staff_id = v_staff.id LIMIT 1;

  v_token   := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
  v_expires := now() + interval '30 days';

  INSERT INTO staff_sessions (staff_id, token, expires_at)
  VALUES (v_staff.id, v_token, v_expires);

  RETURN jsonb_build_object(
    'token',          v_token,
    'expires_at',     v_expires,
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
GRANT EXECUTE ON FUNCTION public.secure_login_staff(text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_login_student — same treatment. The existing "not activated yet"
-- message is left exactly as-is (a real, intentional UX helper for a
-- legitimate not-yet-activated student) — only a lockout check up front and
-- a failure hook on the final wrong-password branch are added.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_login_student(p_student_code text, p_password_hash text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_student students%ROWTYPE;
  v_token   TEXT;
  v_expires TIMESTAMPTZ;
  v_key     TEXT;
BEGIN
  IF p_student_code IS NULL OR p_password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid Student ID or password' USING ERRCODE = '42501';
  END IF;

  v_key := 'student:' || upper(trim(p_student_code));
  IF _login_rate_limited(v_key) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_student
  FROM students
  WHERE student_code = upper(trim(p_student_code))
  LIMIT 1;
  IF NOT FOUND THEN
    PERFORM _login_record_failure(v_key);
    RETURN NULL;
  END IF;
  IF v_student.account_status IS DISTINCT FROM 'active' OR v_student.password_hash IS NULL THEN
    RAISE EXCEPTION 'Account not activated yet — please go to "Activate your account" first' USING ERRCODE = '42501';
  END IF;
  IF v_student.password_hash IS DISTINCT FROM p_password_hash THEN
    PERFORM _login_record_failure(v_key);
    RETURN NULL;
  END IF;

  PERFORM _login_clear_failures(v_key);

  v_token   := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
  v_expires := now() + interval '30 days';

  INSERT INTO student_sessions (student_id, token, expires_at)
  VALUES (v_student.id, v_token, v_expires);

  RETURN jsonb_build_object(
    'token',      v_token,
    'expires_at', v_expires
  ) || to_jsonb(v_student);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_login_student(text, text) TO anon, authenticated;

COMMIT;
