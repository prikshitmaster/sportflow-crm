-- ============================================================
-- 0130 — secure_update_payment: allow the period label to be updated
-- ============================================================
-- WHY
--   Two surfaces read a payment's period from two different columns:
--     • Dashboard.jsx parses the `month` TEXT label ('Jul 2026') to split
--       collections into "this month" vs "advance".
--     • Reports.jsx filters on the `date` column.
--
--   secure_update_payment could set `date` but NOT `month`, so editing a
--   payment's date moved it in Reports while leaving the Dashboard label
--   pointing at the old month — the same payment reported under two
--   different months, with no way to reconcile.
--
--   Adding `month` to the settable fields lets updatePaymentDate keep both
--   in step. Same guards as before (payments.manage, same-academy, branch
--   scope) — only the SET list changes.
--
-- Body copied from security-v3/02_branch_writes_core.sql (the current
-- authoritative definition) with one line added.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_update_payment(
  p_payment_id TEXT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_payment_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT p.academy_id, s.branch_id
    INTO v_payment_academy, v_student_branch
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;

  IF v_payment_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: payment belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  UPDATE payments SET
    status         = CASE WHEN p_payload ? 'status'        THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    mode           = CASE WHEN p_payload ? 'mode'          THEN NULLIF(p_payload->>'mode','')                              ELSE mode           END,
    date           = CASE WHEN p_payload ? 'date'          THEN COALESCE(NULLIF(p_payload->>'date','')::DATE, date)        ELSE date           END,
    month          = CASE WHEN p_payload ? 'month'         THEN COALESCE(NULLIF(p_payload->>'month',''), month)            ELSE month          END,
    amount         = CASE WHEN p_payload ? 'amount'        THEN COALESCE(NULLIF(p_payload->>'amount','')::NUMERIC, amount) ELSE amount         END,
    months_covered = CASE WHEN p_payload ? 'monthsCovered' THEN COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, months_covered) ELSE months_covered END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN p_payload->>'notes'                                        ELSE notes          END
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_payment(TEXT, JSONB, TEXT) TO anon, authenticated;
