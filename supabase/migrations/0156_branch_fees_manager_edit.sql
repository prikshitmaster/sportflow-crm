-- ============================================================
-- 0156_branch_fees_manager_edit.sql
--
-- Lets a BRANCH MANAGER edit their own branch's trial fee, kit fee and
-- tax settings. Until now only an owner could: secure_update_sport_branch
-- rejects any actor_kind other than 'owner', and SportSelectRoute in
-- App.jsx redirects non-owners away from the only page that calls it. So
-- a manager had no route to the setting and no permission to save it.
--
-- WHY A NEW NARROW RPC instead of widening secure_update_sport_branch:
-- that function also writes branch_name, address, photo_url and — the
-- dangerous one — manager_id. Handing a manager a function that can
-- rewrite manager_id lets them assign the branch to someone else, or
-- keep it after being removed. Rather than bolt per-field authorisation
-- onto a 12-argument function, this one can only ever touch the six
-- fee/tax columns. The narrow surface IS the security control, so a
-- crafted direct API call gains nothing the UI doesn't already offer.
--
-- secure_update_sport_branch is deliberately left exactly as it is:
-- still owner-only, still the only way to change a branch's identity.
--
-- AUTHORISATION, in order:
--   1. branch must exist and be in the actor's academy  (tenant scope)
--   2. owner                                            → allowed
--   3. staff whose id == sport_branches.manager_id      → allowed
--   4. anything else                                    → forbidden
-- Note this checks manager_id on the ROW, not the actor's own branch_id:
-- being *assigned* to a branch (branch_id) is not the same as *managing*
-- it, and only the latter should set prices.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION secure_update_branch_fees(
  p_branch_id    UUID,
  p_trial_fee    NUMERIC DEFAULT NULL,
  p_kit_fee      NUMERIC DEFAULT NULL,
  p_tax_percent  NUMERIC DEFAULT NULL,
  p_tax_on_fees  BOOLEAN DEFAULT FALSE,
  p_tax_on_trial BOOLEAN DEFAULT FALSE,
  p_tax_on_kit   BOOLEAN DEFAULT FALSE,
  p_token        TEXT    DEFAULT NULL
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

  -- Same-academy first: a missing row and another tenant's row must be
  -- indistinguishable to the caller.
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind <> 'owner'
     AND NOT (a.actor_kind = 'staff' AND v_mgr IS NOT NULL AND v_mgr = a.actor_id) THEN
    RAISE EXCEPTION 'forbidden: not the manager of this branch' USING ERRCODE = '42501';
  END IF;

  -- A rate outside 0-100 is always a typo and would overcharge every
  -- parent on this branch. The table CHECK from 0154 catches it too;
  -- this returns a message a human can act on.
  IF p_tax_percent IS NOT NULL AND (p_tax_percent < 0 OR p_tax_percent > 100) THEN
    RAISE EXCEPTION 'tax rate must be between 0 and 100' USING ERRCODE = '22023';
  END IF;

  UPDATE sport_branches SET
    trial_fee    = p_trial_fee,
    kit_fee      = p_kit_fee,
    tax_percent  = p_tax_percent,
    tax_on_fees  = COALESCE(p_tax_on_fees,  FALSE),
    tax_on_trial = COALESCE(p_tax_on_trial, FALSE),
    tax_on_kit   = COALESCE(p_tax_on_kit,   FALSE)
  WHERE id = p_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_branch_fees(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'secure_update_branch_fees';
--   -- and confirm the owner-only one is untouched:
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'secure_update_sport_branch';
