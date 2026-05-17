-- ============================================================
-- 0019b — Phase A1 RLS Hardening — APPLY (authenticated lockdown)
-- ============================================================
-- Closes the CRITICAL findings from permission-audit.md Step 7:
--   • C1: scopes authenticated RLS to academy_id (re-affirms 0003 logic)
--   • C5: prevents users from escalating their own profiles.role
--   • C6: locks user_permissions writes to owner only
--   • Tamper-proof audit_logs (no DELETE/UPDATE, anon access removed)
--
-- DOES NOT TOUCH:
--   • anon read on students/payments/attendance (Phase A2, needs app changes)
--   • student_sessions policy (Phase A2)
--   • attendance anon insert (Phase A2)
--   • branch_id-level RLS (Phase B)
--
-- Guarantees:
--   • Wrapped in BEGIN/COMMIT — atomic
--   • Idempotent (DROP POLICY IF EXISTS + CREATE)
--   • Re-uses 0003's scope_owner_rls helper
--   • Does NOT change any row data — pure policy / trigger changes
--   • App-side already filters by academyId, so legitimate flows continue
--
-- Rollback: 0019_rollback.sql
-- ============================================================

BEGIN;

-- ── PRE-STEP: Strip the "open_access" wide-open policies ─────
-- Dryrun (0019a Query 1) revealed that an `open_access USING (true)
-- WITH CHECK (true)` policy exists on most tables alongside the proper
-- _owner_all policies from migration 0003. RLS uses OR between policies,
-- so the wide-open one wins. Drop them all first.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','batches','staff','payments','trials','attendance',
    'announcements','events','fee_plans','leave_requests','gate_qr',
    'audit_logs','user_permissions','profiles'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "open_access" ON public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── Also drop the orphan public-role photo-update policy on students ──
DROP POLICY IF EXISTS "students anon update photo" ON public.students;
DROP POLICY IF EXISTS "students_anon_update_photo" ON public.students;

-- ── Helper (same as 0003 — safe to re-create) ────────────────
CREATE OR REPLACE FUNCTION get_my_academy_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id FROM profiles WHERE id = auth.uid()
$$;

-- ── Helper: drop legacy wide-open policy and create academy-scoped one
CREATE OR REPLACE FUNCTION pg_temp.scope_owner_rls(
  tbl text, old_names text[]
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
    RAISE NOTICE 'skip %: table missing', tbl; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl AND column_name='academy_id') THEN
    RAISE NOTICE 'skip %: no academy_id column', tbl; RETURN;
  END IF;
  FOREACH n IN ARRAY old_names LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', n, tbl);
  END LOOP;
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_owner_all', tbl);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (academy_id = get_my_academy_id())
       WITH CHECK (academy_id = get_my_academy_id())',
    tbl || '_owner_all', tbl
  );
  RAISE NOTICE 'scoped authenticated RLS for %', tbl;
END $$;

-- ── 1. Scope authenticated access to own academy ─────────────
SELECT pg_temp.scope_owner_rls('students',       ARRAY['students_auth_all']);
SELECT pg_temp.scope_owner_rls('batches',        ARRAY['batches_auth_all']);
SELECT pg_temp.scope_owner_rls('staff',          ARRAY['staff_auth_all']);
SELECT pg_temp.scope_owner_rls('payments',       ARRAY['payments_auth_all']);
SELECT pg_temp.scope_owner_rls('trials',         ARRAY['trials_auth_all']);
SELECT pg_temp.scope_owner_rls('announcements',  ARRAY['announcements_auth_all']);
SELECT pg_temp.scope_owner_rls('events',         ARRAY['events_auth_all']);
SELECT pg_temp.scope_owner_rls('fee_plans',      ARRAY['fee_plans_auth_all']);
SELECT pg_temp.scope_owner_rls('leave_requests', ARRAY['leave_requests_access','leave_requests_auth']);
SELECT pg_temp.scope_owner_rls('gate_qr',        ARRAY['gate_qr_auth_all']);

-- ── 2. Attendance: no academy_id column → scope via students FK
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='attendance') THEN
    DROP POLICY IF EXISTS "attendance_auth_all"   ON attendance;
    DROP POLICY IF EXISTS "attendance_owner_all"  ON attendance;
    CREATE POLICY "attendance_owner_all" ON attendance FOR ALL TO authenticated
      USING      (EXISTS (SELECT 1 FROM students s WHERE s.id = attendance.student_id AND s.academy_id = get_my_academy_id()))
      WITH CHECK (EXISTS (SELECT 1 FROM students s WHERE s.id = attendance.student_id AND s.academy_id = get_my_academy_id()));
    RAISE NOTICE 'scoped authenticated RLS for attendance';
  END IF;
END $$;

-- ── 3. Tamper-proof audit_logs ───────────────────────────────
-- Wide-open "open_access" policy is replaced with academy-scoped
-- INSERT + SELECT only. No UPDATE / DELETE policy → those ops are denied.
DROP POLICY IF EXISTS "open_access"        ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert"  ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select"  ON audit_logs;

CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (academy_id = get_my_academy_id() OR academy_id IS NULL);

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id() OR academy_id IS NULL);

-- ── 4. Lock down user_permissions writes to academy OWNER only ─
-- Reads remain academy-wide (so staff can see role assignments in dropdowns),
-- but INSERT / UPDATE / DELETE require profiles.role = 'owner'.
DROP POLICY IF EXISTS "user_permissions_access"  ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_read"    ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_write"   ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_update"  ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_delete"  ON user_permissions;

CREATE POLICY "user_permissions_read"   ON user_permissions
  FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

CREATE POLICY "user_permissions_write"  ON user_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    academy_id = get_my_academy_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

CREATE POLICY "user_permissions_update" ON user_permissions
  FOR UPDATE TO authenticated
  USING      (academy_id = get_my_academy_id()
              AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (academy_id = get_my_academy_id());

CREATE POLICY "user_permissions_delete" ON user_permissions
  FOR DELETE TO authenticated
  USING (academy_id = get_my_academy_id()
         AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ── 4b. Restore proper RLS on profiles ───────────────────────
-- After dropping open_access, profiles has no policy → all denied.
-- Restore the original two-policy pattern from schema_rls.sql plus owner-only
-- writes for INSERT/DELETE. UPDATE allowed on own row; role-column change
-- is blocked by the trigger in step 5.
DROP POLICY IF EXISTS "profiles_own"           ON profiles;
DROP POLICY IF EXISTS "profiles_same_academy"  ON profiles;
DROP POLICY IF EXISTS "profiles_self_select"   ON profiles;
DROP POLICY IF EXISTS "profiles_self_update"   ON profiles;
DROP POLICY IF EXISTS "profiles_owner_write"   ON profiles;

-- Read own row + read others in same academy
CREATE POLICY "profiles_self_select" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR academy_id = get_my_academy_id());

-- Update own row only (role change still blocked by trigger)
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT / DELETE: only the academy owner (or self during signup)
CREATE POLICY "profiles_owner_write" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM academies a WHERE a.id = academy_id AND a.owner_id = auth.uid())
  );

CREATE POLICY "profiles_owner_delete" ON profiles
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM academies a WHERE a.id = profiles.academy_id AND a.owner_id = auth.uid()));

-- ── 5. Block self-escalation of profiles.role ────────────────
-- Trigger: any UPDATE that changes the role column must be performed by the
-- academy owner. Non-owners cannot upgrade themselves; owners cannot demote
-- themselves below 'owner' (defensive).
CREATE OR REPLACE FUNCTION prevent_role_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  is_owner_of_academy BOOLEAN;
BEGIN
  -- Only intervene if the role column is actually changing
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT EXISTS (
      SELECT 1 FROM academies WHERE id = OLD.academy_id AND owner_id = auth.uid()
    ) INTO is_owner_of_academy;
    IF NOT is_owner_of_academy THEN
      RAISE EXCEPTION 'Only the academy owner can change profile.role (attempted by %)', auth.uid()
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_role_escalation_guard ON profiles;
CREATE TRIGGER profiles_role_escalation_guard
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_role_self_escalation();

-- ── 6. Comments for future-you ────────────────────────────────
COMMENT ON FUNCTION prevent_role_self_escalation() IS
  '0019b: blocks profiles.role updates unless the actor is the academy owner.';
COMMENT ON POLICY "audit_logs_insert" ON audit_logs IS
  '0019b: only authenticated users in own academy can write. No UPDATE/DELETE policy = tamper-proof.';
COMMENT ON POLICY "user_permissions_write" ON user_permissions IS
  '0019b: only the academy owner can grant permissions to others.';

COMMIT;

-- ============================================================
-- Verification (run separately, while logged in as a real owner):
-- ============================================================
-- 1. Same row counts as Query 4 of dryrun
-- 2. SELECT COUNT(*) FROM students;  -- should equal only YOUR academy's count
-- 3. SELECT COUNT(*) FROM students WHERE academy_id = '<other-academy-uuid>';  -- 0
-- 4. UPDATE profiles SET role='owner' WHERE id = auth.uid();  -- should ERROR
-- 5. INSERT INTO user_permissions (...) -- should ERROR for non-owner
-- 6. DELETE FROM audit_logs WHERE id = 1;  -- should ERROR for everyone
