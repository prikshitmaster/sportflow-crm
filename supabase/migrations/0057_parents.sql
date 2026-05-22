-- ============================================================
-- 0057 — Parents (basic): new role for parents to manage kids
-- ============================================================
-- ADDITIVE ONLY. Does NOT touch:
--   - anon SELECT on existing tables (staff/student login keeps working)
--   - existing RLS policies
--   - existing RPCs
--
-- Adds:
--   - parents              (UUID PK, linked to auth.users via auth_user_id)
--   - parent_students      (join table; parent_id UUID × student_id BIGINT)
--   - students.parent_id   (nullable; legacy parent_name/parent_phone untouched)
--   - current_user_academy_id() helper
--   - SECURITY DEFINER RPCs for owner/parent ops
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. parents table
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id    UUID        NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  auth_user_id  UUID        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  email         TEXT,
  notification_prefs JSONB  DEFAULT '{"sms":true,"whatsapp":true,"email":false,"push":true}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Phone is the natural key WITHIN an academy. The same phone can legitimately
-- exist across academies (a parent with kids at different clubs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_parents_phone_academy ON parents(academy_id, phone);
CREATE INDEX        IF NOT EXISTS idx_parents_auth_user    ON parents(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_parents_academy      ON parents(academy_id);


-- ════════════════════════════════════════════════════════════
-- 2. parent_students join
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parent_students (
  parent_id     UUID    NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  student_id    BIGINT  NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship  TEXT,                                       -- 'mother' | 'father' | 'guardian'
  is_primary    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);


-- ════════════════════════════════════════════════════════════
-- 3. students.parent_id (nullable — legacy fields untouched)
-- ════════════════════════════════════════════════════════════

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_parent_id ON students(parent_id) WHERE parent_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- 4. current_user_academy_id() helper
-- ════════════════════════════════════════════════════════════
-- Resolves the academy of the currently authenticated user from any of:
--   - profiles (owner)
--   - staff    (if migrated to Supabase Auth later)
--   - parents  (new — phone OTP signup)
-- Returns NULL for anon callers (staff/student still use custom tokens →
-- their RLS path is the existing wide-open SELECT, not this helper).

CREATE OR REPLACE FUNCTION current_user_academy_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id FROM profiles WHERE id = auth.uid()
  UNION ALL
  SELECT academy_id FROM parents  WHERE auth_user_id = auth.uid()
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION current_user_academy_id() TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 5. Enable RLS on new tables
-- ════════════════════════════════════════════════════════════
-- Note: these policies only apply to the `authenticated` role.
-- Existing anon-role staff/student access paths are unaffected because they
-- never touch these tables.

ALTER TABLE parents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;

-- Parent reads own row + owner reads all parents in their academy
DROP POLICY IF EXISTS parents_select ON parents;
CREATE POLICY parents_select ON parents
FOR SELECT TO authenticated
USING (
  -- Self
  auth_user_id = auth.uid()
  OR
  -- Owner of this academy
  academy_id = current_user_academy_id()
);

-- Parent reads links to own kids; owner reads all
DROP POLICY IF EXISTS parent_students_select ON parent_students;
CREATE POLICY parent_students_select ON parent_students
FOR SELECT TO authenticated
USING (
  parent_id IN (SELECT id FROM parents WHERE auth_user_id = auth.uid())
  OR
  EXISTS (
    SELECT 1 FROM parents p
    WHERE p.id = parent_students.parent_id
      AND p.academy_id = current_user_academy_id()
  )
);

-- All writes go through SECURITY DEFINER RPCs below — no direct INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS parents_no_write          ON parents;
DROP POLICY IF EXISTS parent_students_no_write  ON parent_students;
-- No INSERT/UPDATE/DELETE policies = denied for everyone by default with RLS on.


-- ════════════════════════════════════════════════════════════
-- 6. SECURITY DEFINER RPCs — owner-side parent management
-- ════════════════════════════════════════════════════════════

-- Create a parent and link to a student. Idempotent on (academy_id, phone).
-- Returns the parent row as JSON.
CREATE OR REPLACE FUNCTION secure_create_parent(
  p_name          TEXT,
  p_phone         TEXT,
  p_email         TEXT    DEFAULT NULL,
  p_student_id    BIGINT  DEFAULT NULL,
  p_relationship  TEXT    DEFAULT NULL,
  p_token         TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a       RECORD;
  v_row   parents%ROWTYPE;
  v_stud  RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage parents' USING ERRCODE = '42501';
  END IF;

  -- Upsert by (academy_id, phone)
  INSERT INTO parents (academy_id, name, phone, email)
  VALUES (a.academy_id, p_name, p_phone, NULLIF(p_email, ''))
  ON CONFLICT (academy_id, phone) DO UPDATE
    SET name       = EXCLUDED.name,
        email      = COALESCE(EXCLUDED.email, parents.email),
        updated_at = NOW()
  RETURNING * INTO v_row;

  -- Optional: link a student in the same call
  IF p_student_id IS NOT NULL THEN
    -- Verify the student belongs to this academy (cross-tenant defense)
    SELECT id, academy_id INTO v_stud FROM students WHERE id = p_student_id;
    IF v_stud.academy_id IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'student not found in this academy' USING ERRCODE = '42501';
    END IF;

    INSERT INTO parent_students (parent_id, student_id, relationship, is_primary)
    VALUES (v_row.id, p_student_id, NULLIF(p_relationship, ''), TRUE)
    ON CONFLICT (parent_id, student_id) DO UPDATE
      SET relationship = EXCLUDED.relationship;

    -- Also stamp students.parent_id if blank (legacy convenience)
    UPDATE students SET parent_id = v_row.id
      WHERE id = p_student_id AND parent_id IS NULL;
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_parent(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO anon, authenticated;


-- Link an existing parent to another child (multi-child households).
CREATE OR REPLACE FUNCTION secure_link_student_to_parent(
  p_parent_id     UUID,
  p_student_id    BIGINT,
  p_relationship  TEXT    DEFAULT NULL,
  p_is_primary    BOOLEAN DEFAULT FALSE,
  p_token         TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a       RECORD;
  v_parent RECORD;
  v_stud   RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, academy_id INTO v_parent FROM parents  WHERE id = p_parent_id;
  SELECT id, academy_id INTO v_stud   FROM students WHERE id = p_student_id;

  IF v_parent.academy_id IS DISTINCT FROM a.academy_id
     OR v_stud.academy_id   IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'cross-academy link rejected' USING ERRCODE = '42501';
  END IF;

  INSERT INTO parent_students (parent_id, student_id, relationship, is_primary)
  VALUES (p_parent_id, p_student_id, NULLIF(p_relationship, ''), COALESCE(p_is_primary, FALSE))
  ON CONFLICT (parent_id, student_id) DO UPDATE
    SET relationship = EXCLUDED.relationship,
        is_primary   = EXCLUDED.is_primary;

  RETURN json_build_object('parent_id', p_parent_id, 'student_id', p_student_id, 'ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_link_student_to_parent(UUID, BIGINT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;


-- Unlink (owner-only)
CREATE OR REPLACE FUNCTION secure_unlink_student_from_parent(
  p_parent_id  UUID,
  p_student_id BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM parent_students
   WHERE parent_id  = p_parent_id
     AND student_id = p_student_id
     AND EXISTS (SELECT 1 FROM parents WHERE id = p_parent_id AND academy_id = a.academy_id);

  RETURN json_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_unlink_student_from_parent(UUID, BIGINT, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 7. SECURITY DEFINER RPCs — parent-side self-service
-- ════════════════════════════════════════════════════════════

-- Called after a parent completes phone-OTP signup. Binds the auth.uid()
-- to an existing parents row by phone match (owner must have pre-added them).
-- This is the "claim my account" step — no owner intervention needed once
-- the parent is in the table.
CREATE OR REPLACE FUNCTION secure_claim_parent_account(
  p_phone TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_row    parents%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Find a parent record with this phone that isn't already claimed by someone else
  SELECT * INTO v_row FROM parents
   WHERE phone = p_phone
     AND (auth_user_id IS NULL OR auth_user_id = v_uid)
   ORDER BY created_at
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no parent record found for this phone — ask the academy to add you'
      USING ERRCODE = '42501';
  END IF;

  UPDATE parents
     SET auth_user_id = v_uid,
         updated_at   = NOW()
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_claim_parent_account(TEXT) TO authenticated;


-- Parent dashboard payload — one round trip for the home screen.
-- Returns { parent, children: [{ ...student, recent_attendance, payment_status }] }
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


-- Update notification preferences (parent self-service)
CREATE OR REPLACE FUNCTION secure_update_parent_prefs(
  p_prefs JSONB
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_row   parents%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE parents
     SET notification_prefs = COALESCE(p_prefs, notification_prefs),
         updated_at         = NOW()
   WHERE auth_user_id = v_uid
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_parent_prefs(JSONB) TO authenticated;


-- List parents in an academy (owner-facing — used by Students page to link existing parents)
CREATE OR REPLACE FUNCTION secure_list_parents(
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a    RECORD;
  v_rows JSON;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.name), '[]'::json) INTO v_rows
  FROM (
    SELECT p.id, p.name, p.phone, p.email,
           p.auth_user_id IS NOT NULL AS claimed,
           (SELECT count(*)::int FROM parent_students ps WHERE ps.parent_id = p.id) AS children_count
    FROM parents p
    WHERE p.academy_id = a.academy_id
  ) t;

  RETURN v_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_list_parents(TEXT) TO anon, authenticated;
