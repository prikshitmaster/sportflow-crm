-- ============================================================
-- 0142 — Per-branch trial fee + trial Razorpay payment support
-- ============================================================
-- WHAT
--   • sport_branches.trial_fee NUMERIC — owner-configurable per (sport,
--     branch) row, shown/charged on the public /join funnel. NULL falls
--     back to the long-standing hardcoded default of ₹590.
--   • trials.razorpay_payment_id / razorpay_order_id — set when a trial's
--     fee is paid online, for idempotency + audit (mirrors payments.gateway_*
--     from 0058_razorpay.sql).
--   • secure_insert_sport_branch / secure_update_sport_branch gain
--     p_trial_fee. Both change their argument list, so — per the exact
--     precedent this codebase already established in 0065/0137 — the
--     OLD-signature function must be DROPped first; CREATE OR REPLACE only
--     replaces a function with the IDENTICAL argument list, otherwise it
--     creates a second ambiguous overload.
--   • secure_public_trial_branches_v2 — SAME signature (p_slug only), so a
--     plain CREATE OR REPLACE is enough here; just add trial_fee to the
--     returned columns.
--   • secure_submit_public_trial_v2 gains p_trial_fee_mode and
--     p_trial_fee_amount (both new trailing optional params → old-signature
--     DROP required, same reasoning as above). Replaces the hardcoded
--     `590, 'Not collected'` literals with these, defaulting to the exact
--     same values when omitted — existing behavior is unchanged unless the
--     frontend explicitly opts in.
--
-- Every signature below was verified against the LIVE function via
-- pg_get_functiondef / pg_get_function_arguments before writing this, not
-- assumed from the migration files (this codebase's migration files have
-- previously been wrong about live signatures).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New columns ─────────────────────────────────────────
ALTER TABLE sport_branches ADD COLUMN IF NOT EXISTS trial_fee NUMERIC;
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trials_razorpay_payment_id
  ON trials(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- ── 2. secure_insert_sport_branch — add p_trial_fee ────────
DROP FUNCTION IF EXISTS secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_insert_sport_branch(
  p_sport_name  TEXT,
  p_branch_name TEXT,
  p_address     TEXT    DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL,
  p_trial_fee   NUMERIC DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row sport_branches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sport_branches (academy_id, sport_name, branch_name, address, photo_url, trial_fee)
  VALUES (a.academy_id, p_sport_name, p_branch_name, NULLIF(p_address,''), NULLIF(p_photo_url,''), p_trial_fee)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- ── 3. secure_update_sport_branch — add p_trial_fee ────────
DROP FUNCTION IF EXISTS secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id   UUID,
  p_branch_name TEXT    DEFAULT NULL,
  p_address     TEXT    DEFAULT NULL,
  p_manager_id  BIGINT  DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL,
  p_trial_fee   NUMERIC DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
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
    trial_fee   = p_trial_fee
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- ── 4. secure_public_trial_branches_v2 — return trial_fee too ─
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
      SELECT id, sport_name, branch_name, photo_url, address, trial_fee
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches_v2(TEXT) TO anon, authenticated;

-- ── 5. secure_submit_public_trial_v2 — parameterize the fee ─
DROP FUNCTION IF EXISTS secure_submit_public_trial_v2(TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_submit_public_trial_v2(
  p_slug                     TEXT,
  p_branch_id                UUID,
  p_batch_id                 BIGINT  DEFAULT NULL,
  p_name                     TEXT    DEFAULT NULL,
  p_parent_name              TEXT    DEFAULT NULL,
  p_emergency_contact_name   TEXT    DEFAULT NULL,
  p_emergency_contact_phone  TEXT    DEFAULT NULL,
  p_dob                      DATE    DEFAULT NULL,
  p_age                      INT     DEFAULT NULL,
  p_medical_notes            TEXT    DEFAULT NULL,
  p_document_path            TEXT    DEFAULT NULL,
  p_trial_fee_mode           TEXT    DEFAULT 'Not collected',
  p_trial_fee_amount         INT     DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_phone   TEXT;
  v_academy UUID;
  v_sport   TEXT;
  v_id      BIGINT;
  v_name    TEXT;
  v_parent  TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id_v2(p_slug) THEN
    RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM batches
      WHERE id = p_batch_id
        AND branch_id = p_branch_id
        AND academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(sports) s WHERE lower(s) = lower(v_sport))
    ) THEN
      RAISE EXCEPTION 'invalid batch for this branch' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_name   := NULLIF(TRIM(p_name), '');
  v_parent := NULLIF(TRIM(p_parent_name), '');
  IF v_name IS NULL OR v_parent IS NULL THEN
    RAISE EXCEPTION 'name and parent name are required' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT COUNT(*) FROM trials
    WHERE phone = v_phone AND academy_id = v_academy
      AND created_at > now() - interval '1 day'
  ) >= 4 THEN
    RAISE EXCEPTION 'too many submissions — please contact the academy directly' USING ERRCODE = '22023';
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, dob, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id,
    emergency_contact_name, emergency_contact_phone, medical_notes, document_path
  ) VALUES (
    v_name, v_parent, v_phone, p_age, p_dob, v_sport, CURRENT_DATE,
    'App', 'Scheduled', 'new',
    p_batch_id, 1, 0, false, 'academy',
    COALESCE(p_trial_fee_amount, 590), p_trial_fee_mode, v_academy, p_branch_id,
    NULLIF(TRIM(p_emergency_contact_name), ''),
    NULLIF(TRIM(p_emergency_contact_phone), ''),
    NULLIF(TRIM(p_medical_notes), ''),
    NULLIF(TRIM(p_document_path), '')
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT
) TO anon, authenticated;

-- ── 6. Force PostgREST to see the new columns immediately ──
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT trial_fee FROM sport_branches LIMIT 1;
--   SELECT secure_public_trial_branches_v2('ara'); -- rows now include trial_fee
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'secure_submit_public_trial_v2';
