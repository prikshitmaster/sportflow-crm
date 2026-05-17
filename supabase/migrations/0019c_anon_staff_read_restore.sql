-- ============================================================
-- 0019c — Restore anon SELECT on `staff` (login fix)
-- ============================================================
-- Phase A1 (0019b) dropped the `open_access` policy from `staff`,
-- which inadvertently broke staff login. The login uses the anon
-- key (no JWT yet) and joins staff_auth → staff(*). Anon needs
-- SELECT on staff for the join to return data.
--
-- This patch is INTENTIONALLY a small expansion of anon access.
-- The proper fix (RPC-gated staff login that never exposes the
-- staff table to anon) is Phase A2.
--
-- Other tables (students, payments, attendance, batches,
-- announcements, gate_qr) still have their original *_anon_read
-- SELECT policies — those continue to work.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ============================================================

BEGIN;

-- Drop any prior copy (idempotent)
DROP POLICY IF EXISTS "staff_anon_read" ON staff;

-- SELECT-only, no academy filter (staff login lookup happens before
-- the user has any context — same shape as students_anon_read)
CREATE POLICY "staff_anon_read" ON staff FOR SELECT TO anon USING (true);

COMMIT;

-- ============================================================
-- Verification:
-- ============================================================
-- -- as anon (in JS bundle): the staff login query should now succeed
-- -- as authenticated owner: row counts on /coaches page should match baseline
--
-- Rollback:
-- DROP POLICY IF EXISTS "staff_anon_read" ON staff;
-- (this re-breaks staff login until Phase A2 lands)
