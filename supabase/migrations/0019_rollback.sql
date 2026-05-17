-- ============================================================
-- 0019 — Rollback for Phase A1 RLS Hardening
-- ============================================================
-- WARNING:
--   • Restores the OPEN, vulnerable policies from before 0019b
--   • ONLY use if 0019b broke the app and you need to recover fast
--   • Re-introduces all the issues from permission-audit.md
--   • Run a fresh audit before considering this safe long-term
-- ============================================================

BEGIN;

-- ── 1. Drop the academy-scoped policies created by 0019b ──
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['students','batches','staff','payments','trials',
                           'announcements','events','fee_plans','leave_requests',
                           'attendance','gate_qr']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_all', t);
  END LOOP;
END $$;

-- ── 2. Restore the wide-open authenticated policies ──
CREATE POLICY "students_auth_all"       ON students       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "batches_auth_all"        ON batches        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_auth_all"          ON staff          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payments_auth_all"       ON payments       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "trials_auth_all"         ON trials         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "attendance_auth_all"     ON attendance     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "announcements_auth_all"  ON announcements  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gate_qr_auth_all"        ON gate_qr        FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Restore the wide-open audit_logs policy ──
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "open_access" ON audit_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 4. Restore the single user_permissions wide policy ──
DROP POLICY IF EXISTS "user_permissions_read"   ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_write"  ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_update" ON user_permissions;
DROP POLICY IF EXISTS "user_permissions_delete" ON user_permissions;
CREATE POLICY "user_permissions_access" ON user_permissions FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── 5. Remove role-escalation trigger ──
DROP TRIGGER IF EXISTS profiles_role_escalation_guard ON profiles;
DROP FUNCTION IF EXISTS prevent_role_self_escalation();

-- ── 6. Restore the open_access wide-open policies on profiles ──
DROP POLICY IF EXISTS "profiles_self_select"  ON profiles;
DROP POLICY IF EXISTS "profiles_self_update"  ON profiles;
DROP POLICY IF EXISTS "profiles_owner_write"  ON profiles;
DROP POLICY IF EXISTS "profiles_owner_delete" ON profiles;
CREATE POLICY "open_access" ON profiles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 7. Restore the open_access policies on other tables ──
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','batches','staff','payments','trials','attendance',
    'announcements','user_permissions'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('CREATE POLICY "open_access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
