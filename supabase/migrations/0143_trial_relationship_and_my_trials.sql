-- ============================================================
-- 0143 — Relationship, sibling linking, and a "my registered
-- students" RPC for the public /join Profile tab
-- ============================================================
-- WHAT
--   • trials.relationship TEXT — "Son" | "Daughter" | "Ward" | free text
--     ("Other" custom value). No CHECK constraint — deliberately open,
--     unlike trial_fee_mode, since this is descriptive metadata for staff,
--     not a value anything downstream branches logic on.
--   • trials.sibling_of_trial_id BIGINT REFERENCES trials(id) — optional
--     link to an earlier trial from the SAME verified phone at the SAME
--     academy, so staff can see two trials are the same family at a glance.
--     ON DELETE SET NULL — deleting the sibling trial shouldn't cascade-kill
--     this one, just drop the link.
--   • secure_my_trials_v1(p_slug) — NEW. Public RPC, gated by auth.uid()
--     (a completed phone-OTP session — same gate as submit), returns every
--     trial at this academy whose phone matches the caller's OWN verified
--     phone. This is what powers the Profile tab's "your registered
--     students" list — a prospect can only ever see their own family's
--     trials, never anyone else's, because the phone is server-derived
--     from auth.users, never a client parameter (same invariant as submit).
--   • secure_submit_public_trial_v2 gains p_relationship and
--     p_sibling_of_trial_id (new trailing optional params → old-signature
--     DROP required first, same reasoning as 0142). If a sibling id is
--     given, it's validated server-side to belong to the SAME phone +
--     academy before being accepted — never trust a client-supplied id
--     without checking it's actually theirs.
--
-- Signature verified against the LIVE function via pg_get_function_arguments
-- before writing this DROP (per this codebase's established rule).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New columns ─────────────────────────────────────────
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS relationship        TEXT,
  ADD COLUMN IF NOT EXISTS sibling_of_trial_id BIGINT REFERENCES trials(id) ON DELETE SET NULL;

-- ── 2. secure_my_trials_v1 — NEW, phone-scoped read ────────
CREATE OR REPLACE FUNCTION secure_my_trials_v1(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_phone   TEXT;
  v_academy UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  v_academy := _public_trial_academy_id_v2(p_slug);

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::JSON)
    FROM (
      SELECT
        t.id, t.name, t.sport, t.status, t.stage, t.trial_date,
        t.trial_fee_paid, t.trial_fee_mode, t.relationship,
        t.sibling_of_trial_id, t.created_at,
        sb.branch_name
      FROM trials t
      LEFT JOIN sport_branches sb ON sb.id = t.branch_id
      WHERE t.phone = v_phone AND t.academy_id = v_academy
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_my_trials_v1(TEXT) TO anon, authenticated;

-- ── 3. secure_submit_public_trial_v2 — add relationship + sibling link ─
DROP FUNCTION IF EXISTS secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT
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
  p_sibling_of_trial_id      BIGINT  DEFAULT NULL
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
    relationship, sibling_of_trial_id
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
    v_sibling
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT, TEXT, BIGINT
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'secure_submit_public_trial_v2';
--   SELECT proname FROM pg_proc WHERE proname = 'secure_my_trials_v1';
