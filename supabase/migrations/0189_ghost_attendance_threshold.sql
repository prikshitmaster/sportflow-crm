-- ============================================================
-- 0189 — "Not Attending" reporting threshold (per branch)
-- ============================================================
-- WHAT
--   sport_branches.ghost_min_sessions — a student is flagged "Not
--   Attending" in Reports/Dashboard when their attended session count over
--   the last 2 calendar months is <= this number. Default 0 (only flag
--   someone with LITERALLY zero attendance in that window).
--
-- WHY
--   Live audit: 59 of 143 "Active" students had zero attendance in 60
--   days, yet were counted as normal billable customers in every revenue/
--   overdue total — inflating "Expected Revenue" by ~5.5L and "Overdue" by
--   ~2.6L with money from students who have functionally disappeared.
--
--   This is a REPORTING classification only — no student status, paid_till,
--   fees, or due_amount is touched by it. It just tells Reports/Dashboard
--   which Active students to pull into a separate "Not Attending" bucket
--   instead of counting them in the headline numbers.
--
--   secure_update_branch_fees gains p_ghost_min_sessions. Signature
--   changed (new arg), so per the precedent in 0171/0187/0188, the OLD
--   signature must be dropped first — CREATE OR REPLACE only replaces a
--   function with the exact same argument types.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE sport_branches
  ADD COLUMN IF NOT EXISTS ghost_min_sessions INTEGER NOT NULL DEFAULT 0
  CHECK (ghost_min_sessions >= 0);

DROP FUNCTION IF EXISTS secure_update_branch_fees(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION secure_update_branch_fees(
  p_branch_id          UUID,
  p_trial_fee          NUMERIC DEFAULT NULL,
  p_kit_fee            NUMERIC DEFAULT NULL,
  p_tax_percent        NUMERIC DEFAULT NULL,
  p_tax_on_fees        BOOLEAN DEFAULT FALSE,
  p_tax_on_trial       BOOLEAN DEFAULT FALSE,
  p_tax_on_kit         BOOLEAN DEFAULT FALSE,
  p_proration_basis    TEXT    DEFAULT NULL,
  p_auto_calc_dates    BOOLEAN DEFAULT NULL,
  p_ghost_min_sessions INTEGER DEFAULT NULL,
  p_token              TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a       RECORD;
  v_acad  UUID;
  v_mgr   BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, manager_id INTO v_acad, v_mgr
    FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind <> 'owner'
     AND NOT (a.actor_kind = 'staff' AND v_mgr IS NOT NULL AND v_mgr = a.actor_id) THEN
    RAISE EXCEPTION 'forbidden: not the manager of this branch' USING ERRCODE = '42501';
  END IF;

  IF p_tax_percent IS NOT NULL AND (p_tax_percent < 0 OR p_tax_percent > 100) THEN
    RAISE EXCEPTION 'tax rate must be between 0 and 100' USING ERRCODE = '22023';
  END IF;

  IF p_proration_basis IS NOT NULL AND p_proration_basis NOT IN ('calendar', '30day') THEN
    RAISE EXCEPTION 'proration basis must be calendar or 30day' USING ERRCODE = '22023';
  END IF;

  IF p_ghost_min_sessions IS NOT NULL AND p_ghost_min_sessions < 0 THEN
    RAISE EXCEPTION 'ghost_min_sessions cannot be negative' USING ERRCODE = '23514';
  END IF;

  UPDATE sport_branches SET
    trial_fee            = p_trial_fee,
    kit_fee              = p_kit_fee,
    tax_percent          = p_tax_percent,
    tax_on_fees          = COALESCE(p_tax_on_fees,  FALSE),
    tax_on_trial         = COALESCE(p_tax_on_trial, FALSE),
    tax_on_kit           = COALESCE(p_tax_on_kit,   FALSE),
    fee_proration_basis  = COALESCE(p_proration_basis, fee_proration_basis),
    auto_calc_payment_dates = COALESCE(p_auto_calc_dates, auto_calc_payment_dates),
    ghost_min_sessions   = COALESCE(p_ghost_min_sessions, ghost_min_sessions)
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_branch_fees(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, TEXT) TO anon, authenticated;

COMMIT;
