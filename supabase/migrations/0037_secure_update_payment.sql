-- ============================================================
-- 0037 — Phase 2 Stage 5a: secure payment UPDATE RPC
-- ============================================================
-- WHY
--   Stage 4 (migration 0036) closed anon INSERT on payments.
--   But anon UPDATE is still wide-open via payments_anon_update
--   (set in migration 0034). A coach with the anon key can flip
--   any payment from "Unpaid" to "Paid" via DevTools:
--     supabase.from('payments').update({ status: 'Paid' }).eq('id', 'INV-123')
--   That's financial fraud with no audit trail.
--
--   This migration adds a SECURITY DEFINER RPC that gates payment
--   updates behind current_actor() validation and payments.manage perm.
--   The anon UPDATE policy stays alive until migration 0038.
--
-- WHAT THIS DOES NOT DO YET
--   Doesn't remove the anon UPDATE permission from the payments table.
--   Migration 0038 will do that once the JS layer is wired to this RPC.
--
-- UPDATABLE FIELDS
--   Only these fields are touched by the RPC — any field absent from
--   the payload is left unchanged (patching, not full replace):
--     status, mode, date, amount, months_covered, notes
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_update_payment(
  p_payment_id TEXT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_payment_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  -- Verify the payment exists and belongs to the actor's academy.
  SELECT academy_id INTO v_payment_academy
  FROM payments WHERE id = p_payment_id;

  IF v_payment_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: payment belongs to another academy' USING ERRCODE = '42501';
  END IF;

  -- Patch only the fields present in the payload.
  -- Fields absent from the payload retain their current DB value.
  UPDATE payments SET
    status         = CASE WHEN p_payload ? 'status'
                       THEN COALESCE(NULLIF(p_payload->>'status',''), status)
                       ELSE status END,
    mode           = CASE WHEN p_payload ? 'mode'
                       THEN NULLIF(p_payload->>'mode','')
                       ELSE mode END,
    date           = CASE WHEN p_payload ? 'date'
                       THEN COALESCE(NULLIF(p_payload->>'date','')::DATE, date)
                       ELSE date END,
    amount         = CASE WHEN p_payload ? 'amount'
                       THEN COALESCE(NULLIF(p_payload->>'amount','')::NUMERIC, amount)
                       ELSE amount END,
    months_covered = CASE WHEN p_payload ? 'monthsCovered'
                       THEN COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, months_covered)
                       ELSE months_covered END,
    notes          = CASE WHEN p_payload ? 'notes'
                       THEN p_payload->>'notes'
                       ELSE notes END
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_payment(TEXT, JSONB, TEXT) TO anon, authenticated;
