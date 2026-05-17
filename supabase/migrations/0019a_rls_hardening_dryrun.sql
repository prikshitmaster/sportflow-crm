-- ============================================================
-- 0019a — Phase A1 RLS Hardening — DRY RUN (read-only)
-- ============================================================
-- Run FIRST. Nothing modified.
-- Tells us:
--   1. Current RLS policies on core tables (so we know what 0019b will replace)
--   2. Whether 0003 was applied (look for *_owner_all policies)
--   3. Whether the role-escalation trigger exists
--   4. Counts that should remain unchanged after 0019b
-- ============================================================

-- ── Query 1: Current RLS policies on core tables ──
SELECT tablename, policyname, cmd, roles::text, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'students','batches','staff','payments','trials','attendance',
     'announcements','events','fee_plans','leave_requests','gate_qr',
     'audit_logs','user_permissions','profiles'
   )
 ORDER BY tablename, policyname;

-- ── Query 2: Confirm 0003 helper function exists ──
SELECT proname, prosecdef AS security_definer, provolatile
  FROM pg_proc WHERE proname = 'get_my_academy_id';

-- ── Query 3: Check if any role-escalation trigger already exists on profiles ──
SELECT tgname, tgenabled, tgtype
  FROM pg_trigger
 WHERE tgrelid = 'public.profiles'::regclass
   AND NOT tgisinternal;

-- ── Query 4: Row counts (informational — must stay identical after 0019b) ──
SELECT 'students' AS table_name, COUNT(*) AS rows FROM students
UNION ALL SELECT 'batches',       COUNT(*) FROM batches
UNION ALL SELECT 'staff',         COUNT(*) FROM staff
UNION ALL SELECT 'payments',      COUNT(*) FROM payments
UNION ALL SELECT 'trials',        COUNT(*) FROM trials
UNION ALL SELECT 'attendance',    COUNT(*) FROM attendance
UNION ALL SELECT 'announcements', COUNT(*) FROM announcements
UNION ALL SELECT 'audit_logs',    COUNT(*) FROM audit_logs
UNION ALL SELECT 'user_permissions', COUNT(*) FROM user_permissions
UNION ALL SELECT 'profiles',      COUNT(*) FROM profiles;

-- ── Query 5: Verify owner profiles exist (used by new policies) ──
SELECT id, name, role, academy_id FROM profiles WHERE role = 'owner' ORDER BY name;
