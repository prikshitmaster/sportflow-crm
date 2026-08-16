-- ============================================================
-- 0154_branch_tax.sql
--
-- Per-branch, per-fee-type tax. Each branch decides IF it charges tax,
-- at ITS OWN rate, independently for monthly fees / trial fee / kit fee.
-- Mirrors the Trial Fee (0142) and Kit Fee (0147) pattern exactly.
--
-- CORE INVARIANT — read before touching anything downstream:
--   payments.amount and trials.trial_fee_amount stay the GROSS figure the
--   payer actually hands over. tax_amount is the portion OF that which is
--   tax, so base = amount - tax_amount. Tax is never stored additively.
--   Every existing report sums `amount`; storing tax on top would silently
--   change what every historical revenue number means. Rows written before
--   this migration have NULL tax columns and keep summing/printing as-is.
--
-- Four columns rather than one, because "18%" and "does this branch tax
-- trials?" are different questions — a branch can tax the trial fee but
-- not the kit fee, or monthly fees but neither. Toggles default FALSE, so
-- every existing branch behaves identically until an owner opts in. A NULL
-- or zero tax_percent means no tax regardless of the toggles; the app's
-- resolveBranchTax() in src/lib/tax.js enforces that in one place.
--
-- NUMBERING: 0152 is already used by TWO files in this folder
-- (0152_academy_contact_profile.sql and 0152_student_medical_and_relationship.sql)
-- and 0153 is taken. This continues at 0154; the existing collision is
-- left alone rather than renumbered under a live database.
--
-- • secure_insert_sport_branch / secure_update_sport_branch gain four
--   params each. Both change their argument list, so — per the precedent
--   set in 0065/0137/0142/0147 — the OLD-signature function must be
--   DROPped first; CREATE OR REPLACE only replaces a function with an
--   IDENTICAL argument list, otherwise it creates a second ambiguous
--   overload and every call starts failing on "function is not unique".
-- • secure_public_trial_branches_v2 — SAME signature (p_slug only), so a
--   plain CREATE OR REPLACE is enough; just return the tax columns so
--   /join can compute the breakdown client-side.
-- • secure_insert_payment takes (p_payload JSONB, p_token TEXT) — a JSON
--   payload, NOT positional args — so it needs no signature change at
--   all. It just reads two new keys.
--
-- Every signature below was verified against the LIVE database via
-- pg_get_function_arguments before writing these DROPs (this codebase's
-- established rule):
--   secure_insert_sport_branch(p_sport_name text, p_branch_name text,
--     p_address text DEFAULT NULL, p_photo_url text DEFAULT NULL,
--     p_trial_fee numeric DEFAULT NULL, p_token text DEFAULT NULL,
--     p_kit_fee numeric DEFAULT NULL)
--   secure_update_sport_branch(p_branch_id uuid, p_branch_name text DEFAULT NULL,
--     p_address text DEFAULT NULL, p_manager_id bigint DEFAULT NULL,
--     p_photo_url text DEFAULT NULL, p_trial_fee numeric DEFAULT NULL,
--     p_token text DEFAULT NULL, p_kit_fee numeric DEFAULT NULL)
--   secure_public_trial_branches_v2(p_slug text)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New columns ─────────────────────────────────────────
ALTER TABLE sport_branches
  ADD COLUMN IF NOT EXISTS tax_percent  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS tax_on_fees  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_on_trial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_on_kit   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sport_branches.tax_percent  IS 'Branch tax rate, e.g. 18.00 for 18% GST. NULL or 0 = branch charges no tax, whatever the toggles say.';
COMMENT ON COLUMN sport_branches.tax_on_fees  IS 'Apply tax_percent to monthly student fees.';
COMMENT ON COLUMN sport_branches.tax_on_trial IS 'Apply tax_percent to the trial fee at /join.';
COMMENT ON COLUMN sport_branches.tax_on_kit   IS 'Apply tax_percent to the kit fee at /join.';

-- A rate outside 0-100 is always a typo (a stray "1800" would silently
-- overcharge every parent on that branch), so refuse it at the boundary.
ALTER TABLE sport_branches DROP CONSTRAINT IF EXISTS sport_branches_tax_percent_range;
ALTER TABLE sport_branches
  ADD CONSTRAINT sport_branches_tax_percent_range
  CHECK (tax_percent IS NULL OR (tax_percent >= 0 AND tax_percent <= 100));

-- Breakdown columns. amount stays gross; these say how much OF it was tax.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC;

ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS tax_amount  NUMERIC;

COMMENT ON COLUMN payments.tax_amount IS 'Portion of payments.amount that is tax. base = amount - tax_amount. NULL = row predates per-branch tax; receipt prints no tax row.';
COMMENT ON COLUMN trials.tax_amount   IS 'Portion of trials.trial_fee_amount that is tax. NULL = row predates per-branch tax.';

-- ── 2. secure_insert_sport_branch — add the four tax params ─
DROP FUNCTION IF EXISTS secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION secure_insert_sport_branch(
  p_sport_name   TEXT,
  p_branch_name  TEXT,
  p_address      TEXT    DEFAULT NULL,
  p_photo_url    TEXT    DEFAULT NULL,
  p_trial_fee    NUMERIC DEFAULT NULL,
  p_token        TEXT    DEFAULT NULL,
  p_kit_fee      NUMERIC DEFAULT NULL,
  p_tax_percent  NUMERIC DEFAULT NULL,
  p_tax_on_fees  BOOLEAN DEFAULT FALSE,
  p_tax_on_trial BOOLEAN DEFAULT FALSE,
  p_tax_on_kit   BOOLEAN DEFAULT FALSE
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row sport_branches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sport_branches (
    academy_id, sport_name, branch_name, address, photo_url, trial_fee, kit_fee,
    tax_percent, tax_on_fees, tax_on_trial, tax_on_kit
  )
  VALUES (
    a.academy_id, p_sport_name, p_branch_name, NULLIF(p_address,''), NULLIF(p_photo_url,''),
    p_trial_fee, p_kit_fee,
    p_tax_percent, COALESCE(p_tax_on_fees,FALSE), COALESCE(p_tax_on_trial,FALSE), COALESCE(p_tax_on_kit,FALSE)
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN) TO anon, authenticated;

-- ── 3. secure_update_sport_branch — add the four tax params ─
DROP FUNCTION IF EXISTS secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id    UUID,
  p_branch_name  TEXT    DEFAULT NULL,
  p_address      TEXT    DEFAULT NULL,
  p_manager_id   BIGINT  DEFAULT NULL,
  p_photo_url    TEXT    DEFAULT NULL,
  p_trial_fee    NUMERIC DEFAULT NULL,
  p_token        TEXT    DEFAULT NULL,
  p_kit_fee      NUMERIC DEFAULT NULL,
  p_tax_percent  NUMERIC DEFAULT NULL,
  p_tax_on_fees  BOOLEAN DEFAULT FALSE,
  p_tax_on_trial BOOLEAN DEFAULT FALSE,
  p_tax_on_kit   BOOLEAN DEFAULT FALSE
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
    branch_name  = COALESCE(p_branch_name, branch_name),
    address      = p_address,
    manager_id   = p_manager_id,
    photo_url    = p_photo_url,
    trial_fee    = p_trial_fee,
    kit_fee      = p_kit_fee,
    tax_percent  = p_tax_percent,
    tax_on_fees  = COALESCE(p_tax_on_fees,  FALSE),
    tax_on_trial = COALESCE(p_tax_on_trial, FALSE),
    tax_on_kit   = COALESCE(p_tax_on_kit,   FALSE)
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN) TO anon, authenticated;

-- ── 4. secure_public_trial_branches_v2 — return the tax columns ─
-- Same signature (p_slug only) — plain CREATE OR REPLACE, no DROP needed.
-- /join needs these to show the breakdown BEFORE the parent commits; the
-- authoritative charge is still computed server-side in the edge function.
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
      SELECT id, sport_name, branch_name, photo_url, address, trial_fee, kit_fee,
             tax_percent, tax_on_trial, tax_on_kit
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
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'sport_branches'
--      AND column_name IN ('tax_percent','tax_on_fees','tax_on_trial','tax_on_kit');
--   SELECT column_name, table_name FROM information_schema.columns
--    WHERE column_name IN ('tax_percent','tax_amount')
--      AND table_name IN ('payments','trials');
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN
--     ('secure_insert_sport_branch','secure_update_sport_branch','secure_public_trial_branches_v2');
