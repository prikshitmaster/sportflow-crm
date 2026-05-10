-- ============================================================
-- SportFlow CRM — Full Owner Reset
-- Wipes ALL data + academy/owner rows so you can sign up fresh.
--
-- STEPS:
--   1. Run THIS file in Supabase SQL Editor
--   2. Go to Supabase Dashboard → Authentication → Users
--      → delete the old owner account
--   3. Sign up as a new owner in the app (creates fresh academy row)
--   4. Run fresh_seed.sql to load demo data
-- ============================================================

-- ── Wipe all data tables ─────────────────────────────────
TRUNCATE TABLE
  attendance, student_sessions, payments, trials,
  students, batches, staff, events, announcements, leave_requests,
  staff_attendance, gate_qr
RESTART IDENTITY CASCADE;

-- ── Wipe academy-linked tables (order matters for FK deps) ─
DELETE FROM feature_flags;
DELETE FROM staff_invites;
DELETE FROM academy_branches;

-- ── Wipe owner identity rows ─────────────────────────────
-- profiles references academies, so delete profiles first
DELETE FROM profiles;
DELETE FROM academies;

-- ── Verify ───────────────────────────────────────────────
SELECT 'academies'  AS tbl, COUNT(*) FROM academies
UNION ALL
SELECT 'profiles',         COUNT(*) FROM profiles
UNION ALL
SELECT 'students',         COUNT(*) FROM students
UNION ALL
SELECT 'staff',            COUNT(*) FROM staff;

-- All counts should be 0 ↑
-- Now go to Auth → Users → delete old account, then sign up fresh.
