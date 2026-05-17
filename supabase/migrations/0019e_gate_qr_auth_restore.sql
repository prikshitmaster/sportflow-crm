-- ============================================================
-- 0019e — Restore authenticated access to gate_qr
-- ============================================================
-- gate_qr has no academy_id column (it's a single-row global
-- token per academy). 0019b's pre-step dropped "open_access"
-- from gate_qr, and scope_owner_rls() skipped it (no academy_id).
-- Result: RLS ON, zero authenticated policies → owner SELECT and
-- INSERT both denied → "Failed to load Gate QR".
--
-- Fix: restore wide-open authenticated ALL policy. The anon
-- SELECT was already restored by 0019d.
--
-- Long-term: add academy_id to gate_qr and scope properly (Phase B).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "gate_qr_auth_all"   ON gate_qr;
DROP POLICY IF EXISTS "gate_qr_owner_all"  ON gate_qr;

CREATE POLICY "gate_qr_auth_all"
  ON gate_qr FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;
