-- ============================================================
-- 0147_branch_kit_fee.sql
--
-- Adds an owner-configurable Kit Fee per branch, mirroring the existing
-- Trial Fee pattern exactly (0142_trial_fee_and_razorpay.sql). Kit Fee is
-- an optional extra amount (kit/equipment/uniform) added on top of the
-- trial fee at /join registration. No new column on `trials` — the
-- existing trial_fee_amount/trial_fee_paid fields already represent "the
-- total collected at trial stage" as a single lump sum (that's how the
-- app already treats trial fee everywhere downstream — Trials.jsx and
-- the payment receipt in Payments.jsx never break it into line items),
-- so the frontend simply sends trialFee + kitFee as that one total.
--
-- • secure_insert_sport_branch / secure_update_sport_branch gain
--   p_kit_fee. Both change their argument list, so — per the established
--   precedent (0065/0137/0142) — the OLD-signature function must be
--   DROPped first; CREATE OR REPLACE only replaces a function with the
--   IDENTICAL argument list, otherwise it creates a second ambiguous
--   overload.
-- • secure_public_trial_branches_v2 — SAME signature (p_slug only), so a
--   plain CREATE OR REPLACE is enough; just add kit_fee to the returned
--   columns.
--
-- Every signature below was verified against the LIVE function via
-- pg_get_function_arguments before writing this DROP (per this
-- codebase's established rule):
--   secure_insert_sport_branch(p_sport_name text, p_branch_name text,
--     p_address text DEFAULT NULL, p_photo_url text DEFAULT NULL,
--     p_trial_fee numeric DEFAULT NULL, p_token text DEFAULT NULL)
--   secure_update_sport_branch(p_branch_id uuid, p_branch_name text DEFAULT NULL,
--     p_address text DEFAULT NULL, p_manager_id bigint DEFAULT NULL,
--     p_photo_url text DEFAULT NULL, p_trial_fee numeric DEFAULT NULL,
--     p_token text DEFAULT NULL)
--   secure_public_trial_branches_v2(p_slug text)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New column ──────────────────────────────────────────
ALTER TABLE sport_branches ADD COLUMN IF NOT EXISTS kit_fee NUMERIC;

-- ── 2. secure_insert_sport_branch — add p_kit_fee ───────────
DROP FUNCTION IF EXISTS secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION secure_insert_sport_branch(
  p_sport_name  TEXT,
  p_branch_name TEXT,
  p_address     TEXT    DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL,
  p_trial_fee   NUMERIC DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL,
  p_kit_fee     NUMERIC DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row sport_branches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sport_branches (academy_id, sport_name, branch_name, address, photo_url, trial_fee, kit_fee)
  VALUES (a.academy_id, p_sport_name, p_branch_name, NULLIF(p_address,''), NULLIF(p_photo_url,''), p_trial_fee, p_kit_fee)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC) TO anon, authenticated;

-- ── 3. secure_update_sport_branch — add p_kit_fee ───────────
DROP FUNCTION IF EXISTS secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id   UUID,
  p_branch_name TEXT    DEFAULT NULL,
  p_address     TEXT    DEFAULT NULL,
  p_manager_id  BIGINT  DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL,
  p_trial_fee   NUMERIC DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL,
  p_kit_fee     NUMERIC DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM staff WHERE id = p_manager_id AND academy_id = a.academy_id
    ) THEN
      RAISE EXCEPTION 'forbidden: manager not in academy' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE sport_branches SET
    branch_name = COALESCE(p_branch_name, branch_name),
    address     = p_address,
    manager_id  = p_manager_id,
    photo_url   = p_photo_url,
    trial_fee   = p_trial_fee,
    kit_fee     = p_kit_fee
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, NUMERIC, TEXT, NUMERIC) TO anon, authenticated;

-- ── 4. secure_public_trial_branches_v2 — return kit_fee too ─
-- Same signature (p_slug only) — plain CREATE OR REPLACE, no DROP needed.
CREATE OR REPLACE FUNCTION secure_public_trial_branches_v2(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT id, sport_name, branch_name, photo_url, address, trial_fee, kit_fee
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches_v2(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'sport_branches' AND column_name = 'kit_fee';
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN
--     ('secure_insert_sport_branch','secure_update_sport_branch','secure_public_trial_branches_v2');
