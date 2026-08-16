-- ============================================================
-- 0150_public_trial_notifies_branch.sql
--
-- A registration submitted on the public /join funnel told nobody.
-- secure_submit_public_trial_v2 inserted the trial and returned; there is
-- no trigger on trials (verified: pg_trigger has no non-internal rows for
-- the table), and the only "New Trial Lead" notification in the app fires
-- in AppContext when STAFF add a lead by hand. A parent could register at
-- 9pm and the academy would find out whenever someone next opened Trials.
--
-- WHO GETS TOLD, AND WHY IT IS BRANCH-ISOLATED
--   • the academy owner        — sees every branch by definition
--   • that branch's manager    — sport_branches.manager_id, if set
--
--   No other branch's staff is touched. This mirrors the branch rule the
--   announcement fan-out already follows in AppContext (a branch-tagged
--   post never pings another branch), except it is enforced here in SQL
--   rather than in client code, because the caller is an anonymous
--   registrant and must never get to choose who receives a notification.
--
-- The insert is deliberately NOT allowed to fail the registration: the
-- lead is the thing that matters, a missed ping is not. Wrapped in its own
-- exception block so any notification problem is swallowed after the trial
-- row is already committed to the transaction.
--
-- Signature is UNCHANGED from 0149 (p_preferred_days is still the last
-- parameter), so this is a plain CREATE OR REPLACE — no DROP, and no
-- PostgREST overload risk.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

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
  p_email                    TEXT    DEFAULT NULL,
  p_preferred_days           TEXT[]  DEFAULT NULL
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
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT, TEXT, INT, TEXT, BIGINT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   -- one function version, unchanged signature:
--   SELECT count(*), pg_get_function_arguments(oid) FROM pg_proc
--    WHERE proname = 'secure_submit_public_trial_v2' GROUP BY 2;
--
--   -- after a real /join registration, exactly two rows (owner + that
--   -- branch's manager), and none for any other branch's staff:
--   SELECT recipient_type, recipient_id, title, link FROM notifications
--    WHERE type = 'trial' ORDER BY created_at DESC LIMIT 5;
