-- ============================================================
-- 0146_trial_registration_extra_fields.sql
--
-- Adds the extra personal/contact fields to the public /join
-- registration form (mother's name, address, gender, occupation,
-- alternate contact number, email) — father's name reuses the
-- existing `parent` column, just relabelled client-side.
--
-- secure_submit_public_trial_v2 gains 6 new trailing optional
-- params (old-signature DROP required first, same reasoning as
-- 0142/0143).
--
-- Signature verified against the LIVE function via
-- pg_get_function_arguments before writing this DROP (per this
-- codebase's established rule):
--   p_slug text, p_branch_id uuid, p_batch_id bigint DEFAULT NULL,
--   p_name text DEFAULT NULL, p_parent_name text DEFAULT NULL,
--   p_emergency_contact_name text DEFAULT NULL,
--   p_emergency_contact_phone text DEFAULT NULL, p_dob date DEFAULT NULL,
--   p_age integer DEFAULT NULL, p_medical_notes text DEFAULT NULL,
--   p_document_path text DEFAULT NULL,
--   p_trial_fee_mode text DEFAULT 'Not collected',
--   p_trial_fee_amount integer DEFAULT NULL,
--   p_relationship text DEFAULT NULL,
--   p_sibling_of_trial_id bigint DEFAULT NULL
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New columns ─────────────────────────────────────────
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS mother_name             TEXT,
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS occupation              TEXT,
  ADD COLUMN IF NOT EXISTS alternate_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS email                   TEXT;

-- ── 2. secure_submit_public_trial_v2 — add the 6 new fields ─
DROP FUNCTION IF EXISTS secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT, TEXT, BIGINT
);

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
  p_trial_fee_amount         INT     DEFAULT NULL,
  p_relationship             TEXT    DEFAULT NULL,
  p_sibling_of_trial_id      BIGINT  DEFAULT NULL,
  p_mother_name              TEXT    DEFAULT NULL,
  p_address                  TEXT    DEFAULT NULL,
  p_gender                   TEXT    DEFAULT NULL,
  p_occupation               TEXT    DEFAULT NULL,
  p_alternate_contact_phone  TEXT    DEFAULT NULL,
  p_email                    TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_phone     TEXT;
  v_academy   UUID;
  v_sport     TEXT;
  v_id        BIGINT;
  v_name      TEXT;
  v_parent    TEXT;
  v_sibling   BIGINT;
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

  -- A sibling link is only accepted if it's genuinely this same phone's own
  -- earlier trial at this same academy — never trust a client-supplied id
  -- without checking ownership first.
  v_sibling := NULL;
  IF p_sibling_of_trial_id IS NOT NULL THEN
    SELECT id INTO v_sibling FROM trials
    WHERE id = p_sibling_of_trial_id AND phone = v_phone AND academy_id = v_academy;
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
    emergency_contact_name, emergency_contact_phone, medical_notes, document_path,
    relationship, sibling_of_trial_id,
    mother_name, address, gender, occupation, alternate_contact_phone, email
  ) VALUES (
    v_name, v_parent, v_phone, p_age, p_dob, v_sport, CURRENT_DATE,
    'App', 'Scheduled', 'new',
    p_batch_id, 1, 0, false, 'academy',
    COALESCE(p_trial_fee_amount, 590), p_trial_fee_mode, v_academy, p_branch_id,
    NULLIF(TRIM(p_emergency_contact_name), ''),
    NULLIF(TRIM(p_emergency_contact_phone), ''),
    NULLIF(TRIM(p_medical_notes), ''),
    NULLIF(TRIM(p_document_path), ''),
    NULLIF(TRIM(p_relationship), ''),
    v_sibling,
    NULLIF(TRIM(p_mother_name), ''),
    NULLIF(TRIM(p_address), ''),
    NULLIF(TRIM(p_gender), ''),
    NULLIF(TRIM(p_occupation), ''),
    NULLIF(TRIM(p_alternate_contact_phone), ''),
    NULLIF(TRIM(p_email), '')
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT, TEXT, BIGINT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'trials' AND column_name IN
--     ('mother_name','address','gender','occupation','alternate_contact_phone','email');
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'secure_submit_public_trial_v2';
