-- 0158 — Office-side "New Trial Lead" gains the /join contact fields
--
-- migration 0146 added mother_name/address/gender/occupation/
-- alternate_contact_phone/email (plus emergency contact + medical from 0143/
-- earlier) to the `trials` table, but only wired them into
-- secure_submit_public_trial_v2 — the PUBLIC /join path. secure_insert_trial,
-- the OFFICE path behind Trials.jsx's "New Trial Lead" form, never gained a
-- matching payload key, so a lead entered by staff had no way to carry this
-- data even though the columns and the read-mapping (db.js fetchTrials)
-- already fully support it.
--
-- No new columns — this only teaches secure_insert_trial to read 9 more
-- optional keys off the same p_payload it already takes. Signature is
-- UNCHANGED (still just p_payload jsonb, p_token text), so this is a plain
-- CREATE OR REPLACE — no DROP, no PostgREST overload risk.
--
-- Body verified against the live function via pg_get_functiondef before
-- writing this — every existing check (perm, branch, name/phone/fee
-- validation, the trial-fee-paid payments insert) is preserved exactly;
-- only the INSERT's column/value lists gained the 9 new fields.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_insert_trial(p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a          RECORD;
  v_id       BIGINT;
  v_branch   UUID;
  v_fee      NUMERIC;
  v_mode     TEXT;
  v_date     DATE;
  v_sport    TEXT;
  v_name     TEXT;
  v_receipt  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  v_branch := NULLIF(p_payload->>'branchId', '')::UUID;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch := a.branch_id;
  END IF;

  v_fee   := COALESCE((p_payload->>'trialFeePaid')::NUMERIC, 590);
  v_mode  := COALESCE(NULLIF(p_payload->>'trialFeeMode', ''), 'Cash');
  v_date  := (p_payload->>'trialDate')::DATE;
  v_sport := p_payload->>'sport';
  v_name  := p_payload->>'name';

  IF v_name IS NULL OR length(trim(v_name)) = 0 THEN
    RAISE EXCEPTION 'Trial name is required' USING ERRCODE = '23514';
  END IF;
  IF p_payload->>'phone' IS NULL OR length(trim(p_payload->>'phone')) = 0 THEN
    RAISE EXCEPTION 'Trial phone is required' USING ERRCODE = '23514';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'Trial fee cannot be negative' USING ERRCODE = '23514';
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, follow_up, notes,
    quoted_fee, session_start, session_end, dob, age_group, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id,
    gender, mother_name, email, alternate_contact_phone, occupation, address,
    emergency_contact_name, emergency_contact_phone, medical_notes
  ) VALUES (
    v_name,
    COALESCE(p_payload->>'parent', ''),
    p_payload->>'phone',
    NULLIF(p_payload->>'age', '')::INTEGER,
    v_sport,
    v_date,
    NULLIF(p_payload->>'source', ''),
    'Scheduled',
    'scheduled',
    NULLIF(p_payload->>'batchId', '')::BIGINT,
    COALESCE((p_payload->>'trialSessions')::INTEGER, 1),
    0,
    false,
    NULLIF(p_payload->>'followUp', '')::DATE,
    NULLIF(p_payload->>'notes', ''),
    NULLIF(p_payload->>'quotedFee', '')::NUMERIC,
    NULLIF(p_payload->>'sessionStart', '')::TIME,
    NULLIF(p_payload->>'sessionEnd', '')::TIME,
    NULLIF(p_payload->>'dob', '')::DATE,
    NULLIF(p_payload->>'ageGroup', ''),
    COALESCE(NULLIF(p_payload->>'programType', ''), 'academy'),
    v_fee,
    v_mode,
    a.academy_id,
    v_branch,
    NULLIF(trim(p_payload->>'gender'), ''),
    NULLIF(trim(p_payload->>'motherName'), ''),
    NULLIF(trim(p_payload->>'email'), ''),
    NULLIF(trim(p_payload->>'alternateContactPhone'), ''),
    NULLIF(trim(p_payload->>'occupation'), ''),
    NULLIF(trim(p_payload->>'address'), ''),
    NULLIF(trim(p_payload->>'emergencyContactName'), ''),
    NULLIF(trim(p_payload->>'emergencyContactPhone'), ''),
    NULLIF(trim(p_payload->>'medicalNotes'), '')
  )
  RETURNING id INTO v_id;

  IF v_fee > 0 AND v_mode <> 'Not collected' THEN
    v_receipt := next_trial_receipt_id();

    INSERT INTO payments (
      id, student_id, student, amount, month, date, status, mode,
      payment_type, discount_pct, months_covered, academy_id,
      trial_id, branch_id, sport, notes
    ) VALUES (
      v_receipt,
      NULL,
      v_name,
      v_fee,
      to_char(v_date, 'Mon YYYY'),
      v_date,
      'Paid',
      v_mode,
      'trial',
      0,
      1,
      a.academy_id,
      v_id,
      v_branch,
      v_sport,
      'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    );

    UPDATE trials SET receipt_no = v_receipt WHERE id = v_id;
  END IF;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_trial(jsonb, text) TO anon, authenticated;

COMMIT;
