-- ============================================================
-- 0077_unique_staff_email.sql
--
-- Bug: `secure_activate_staff_account` didn't check whether another
-- staff_auth row already used the same email. Owners could send 3
-- invites for "Tanvi Bose", and the same email could activate all
-- three — only the first row would ever be reachable by login (the
-- login query SELECTs the first match), the other two became dead
-- accounts.
--
-- staff_auth has no academy_id column — academy is resolved via
-- staff (staff_auth.staff_id → staff.id → staff.academy_id).
--
-- This migration:
--   1. Pre-flight: deactivates older duplicate activations so the
--      unique index below can be created cleanly. Keeps the first.
--   2. Updates `secure_activate_staff_account` to raise a friendly
--      error if email is already used by another active staff member
--      in the SAME academy.
--   3. Adds a defensive partial unique index on (lower(email)) for
--      active rows. This is global (not per-academy) for simplicity —
--      different academies sharing an email is rare in practice.
-- ============================================================

-- 1. Pre-flight: deactivate older duplicates (keep first per email)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(email)
           ORDER BY id
         ) AS rn
  FROM staff_auth
  WHERE status = 'active' AND email IS NOT NULL
)
UPDATE staff_auth
   SET status = 'inactive',
       email  = NULL
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Updated activation RPC with email-uniqueness check
CREATE OR REPLACE FUNCTION secure_activate_staff_account(
  p_staff_code    TEXT,
  p_join_code     TEXT,
  p_password_hash TEXT,
  p_email         TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth        staff_auth%ROWTYPE;
  v_staff       staff%ROWTYPE;
  v_email       TEXT := lower(trim(p_email));
  v_academy_id  UUID;
  v_dup         INT;
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

  -- Look up this staff's academy via the joined staff row
  SELECT academy_id INTO v_academy_id FROM staff WHERE id = v_auth.staff_id;

  -- New: reject if another ACTIVE staff member in the same academy
  -- already claimed this email.
  SELECT COUNT(*) INTO v_dup
  FROM staff_auth sa
  JOIN staff      s  ON s.id = sa.staff_id
  WHERE sa.id           <> v_auth.id
    AND sa.email        =  v_email
    AND sa.status       =  'active'
    AND s.academy_id    =  v_academy_id;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'Email already used by another staff member in this academy.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE staff_auth SET
    password_hash = p_password_hash,
    status        = 'active',
    join_code     = NULL,
    email         = v_email
  WHERE id = v_auth.id;

  SELECT * INTO v_staff FROM staff WHERE id = v_auth.staff_id;
  RETURN row_to_json(v_staff);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_activate_staff_account(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 3. Defensive partial unique index on email (active only).
-- Global uniqueness keeps the constraint simple and works for the
-- common single-tenant deployment; if cross-academy duplication is
-- needed later, swap to a composite (academy via staff_id) approach.
DROP INDEX IF EXISTS staff_auth_email_active_uniq;
CREATE UNIQUE INDEX staff_auth_email_active_uniq
  ON staff_auth (lower(email))
  WHERE status = 'active' AND email IS NOT NULL;
