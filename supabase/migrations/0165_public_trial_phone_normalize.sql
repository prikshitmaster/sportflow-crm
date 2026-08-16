-- 0165 — Normalize trials.phone for publicly self-registered trials
--
-- secure_submit_public_trial_v2 (the RPC behind the public /join OTP flow)
-- pulled the phone straight from auth.users.phone, which Supabase stores in
-- E.164-without-'+' format (e.g. '919979369521' — country code baked into
-- the digits). Every other phone field in this app (office-entered trials
-- via secure_insert_trial, parents.phone) is a bare 10-digit local number.
-- The mismatch surfaced when converting a publicly-registered trial to a
-- student: the pre-filled Student Phone field held all 12 digits, which
-- failed the 10-digit validation.
--
-- Same normalization already established for parents.phone in
-- 0061_backfill_parents.sql / 0062_parents_admin.sql and reused in the
-- parent/trial test-login edge functions: strip non-digits, keep the last 10.
--
-- IDEMPOTENT — safe to re-run. Signature is UNCHANGED, plain CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_submit_public_trial_v2(
  p_slug text, p_branch_id uuid, p_batch_id bigint DEFAULT NULL::bigint,
  p_name text DEFAULT NULL::text, p_parent_name text DEFAULT NULL::text,
  p_emergency_contact_name text DEFAULT NULL::text, p_emergency_contact_phone text DEFAULT NULL::text,
  p_dob date DEFAULT NULL::date, p_age integer DEFAULT NULL::integer,
  p_medical_notes text DEFAULT NULL::text, p_document_path text DEFAULT NULL::text,
  p_trial_fee_mode text DEFAULT 'Not collected'::text, p_trial_fee_amount integer DEFAULT NULL::integer,
  p_relationship text DEFAULT NULL::text, p_sibling_of_trial_id bigint DEFAULT NULL::bigint,
  p_mother_name text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_gender text DEFAULT NULL::text,
  p_occupation text DEFAULT NULL::text, p_alternate_contact_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text, p_preferred_days text[] DEFAULT NULL::text[]
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid       UUID;
  v_phone     TEXT;
  v_academy   UUID;
  v_sport     TEXT;
  v_id        BIGINT;
  v_name      TEXT;
  v_parent    TEXT;
  v_sibling   BIGINT;
  v_days      TEXT[];
  v_branch    TEXT;
  v_manager   BIGINT;
  v_owner     UUID;
  v_body      TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  -- auth.users.phone is E.164 without the leading '+' — trials.phone must be
  -- a bare 10-digit local number like everywhere else in the app.
  v_phone := right(regexp_replace(v_phone, '\D', '', 'g'), 10);
  IF v_phone IS NULL OR length(v_phone) <> 10 THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, sport_name, branch_name, manager_id
    INTO v_academy, v_sport, v_branch, v_manager
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

  -- Whitelist + canonicalise the day names instead of trusting the array as
  -- sent: only real short day names survive, each at most once, always in
  -- week order. Empty/garbage input lands as NULL, not '{}'.
  SELECT NULLIF(COALESCE(array_agg(w.day ORDER BY w.ord), '{}'), '{}') INTO v_days
  FROM unnest(ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) WITH ORDINALITY AS w(day, ord)
  WHERE EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_preferred_days, '{}'::TEXT[])) x
    WHERE lower(trim(x)) = lower(w.day)
  );

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
    mother_name, address, gender, occupation, alternate_contact_phone, email,
    preferred_days
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
    NULLIF(TRIM(p_email), ''),
    v_days
  )
  RETURNING id INTO v_id;

  -- ── Tell the academy, without ever failing the registration ──
  BEGIN
    v_body := v_name || ' registered for ' || COALESCE(v_sport, 'a sport')
              || ' at ' || COALESCE(v_branch, 'your academy')
              || COALESCE(' · prefers ' || array_to_string(v_days, ', '), '')
              || '.';

    SELECT owner_id INTO v_owner FROM academies WHERE id = v_academy;
    IF v_owner IS NOT NULL THEN
      INSERT INTO notifications (academy_id, recipient_type, recipient_id, title, body, type, link)
      VALUES (v_academy, 'owner', v_owner::TEXT, 'New Registration', v_body, 'trial', '/trials');
    END IF;

    -- Branch manager only. A manager at another branch is not told, which is
    -- the whole point — this is the SQL-side equivalent of the announcement
    -- fan-out's branch check.
    IF v_manager IS NOT NULL THEN
      INSERT INTO notifications (academy_id, recipient_type, recipient_id, title, body, type, link)
      VALUES (v_academy, 'staff', v_manager::TEXT, 'New Registration', v_body, 'trial', '/staff/trials');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Swallowed on purpose: a lead captured with no ping beats a ping that
    -- loses the lead. The trial row above is already part of this transaction.
    NULL;
  END;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$function$;

-- Backfill trials already corrupted by the unstripped country code — only
-- touches rows where the digit count is actually wrong, so already-clean
-- 10-digit rows (office-entered trials) are untouched.
UPDATE trials
SET phone = right(regexp_replace(phone, '\D', '', 'g'), 10)
WHERE phone IS NOT NULL
  AND length(regexp_replace(phone, '\D', '', 'g')) > 10;

COMMIT;
