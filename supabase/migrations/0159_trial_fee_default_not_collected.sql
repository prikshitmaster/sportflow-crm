-- 0159 — Trial fee no longer defaults to "collected"
--
-- WHAT WAS WRONG
--   trials.trial_fee_mode defaulted to 'Cash' at three layers — the column
--   DEFAULT, secure_insert_trial's COALESCE fallback, and secure_update_trial's
--   two COALESCE fallbacks. A staff member who opened "New Trial Lead" and
--   didn't touch the Fee Collected buttons (which pre-selected Cash) silently
--   booked ₹590 of revenue with a trial receipt for money nobody actually
--   collected. Once the coach app started surfacing trial_fee_mode as a
--   "Trial fee paid" badge, this became visibly wrong instead of just quietly
--   wrong — a coach saw a trial marked paid that was never paid.
--
-- FIX
--   Same explicit-opt-in convention /join already uses (submitPublicTrial
--   always inserts 'Not collected' and only flips it once a real payment is
--   verified, or the office manually confirms one). Flip every default here
--   to 'Not collected' too, so a fee only counts as collected when someone
--   deliberately says so.
--
-- NOT DONE HERE, ON PURPOSE
--   No backfill. Existing rows already sitting at 'Cash' may represent real
--   collected money (some have a receipt_no and a linked payments row) —
--   there is no way to tell "really paid, defaulted to match" apart from
--   "never paid, silently defaulted" after the fact. Only new rows and
--   explicit future edits get the safer behaviour.
--
-- Function bodies verified against the live definitions via
-- pg_get_functiondef before writing this — every other check (perm, branch,
-- convert-guard, payment sync) is preserved exactly; only the three 'Cash'
-- fallbacks changed. Signatures UNCHANGED on both functions — plain CREATE
-- OR REPLACE, no DROP, no PostgREST overload risk.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ── 1. Column default ──────────────────────────────────────
ALTER TABLE trials ALTER COLUMN trial_fee_mode SET DEFAULT 'Not collected';

-- ── 2. secure_insert_trial ─────────────────────────────────
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
  v_mode  := COALESCE(NULLIF(p_payload->>'trialFeeMode', ''), 'Not collected');
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

-- ── 3. secure_update_trial ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_trial(p_trial_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a                RECORD;
  v_trial_academy  UUID;
  v_was_converted  BOOLEAN;
  v_old_fee        NUMERIC;
  v_new_fee        NUMERIC;
  v_mode           TEXT;
  v_date           DATE;
  v_sport          TEXT;
  v_name           TEXT;
  v_branch         UUID;
  v_pay_id         TEXT;
  v_pay_student    BIGINT;
  v_receipt        TEXT;
  v_should_book    BOOLEAN;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id, converted, trial_fee_paid
    INTO v_trial_academy, v_was_converted, v_old_fee
  FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial edit' USING ERRCODE = '42501';
  END IF;

  -- Once converted, the first-month payment was already netted by this
  -- exact amount (AppContext.jsx:913). Letting the fee change now would
  -- permanently desync the two rows and double-book or under-book the
  -- difference. Refuse rather than silently drift.
  IF v_was_converted
     AND p_payload ? 'trialFeePaid'
     AND (p_payload->>'trialFeePaid')::NUMERIC IS DISTINCT FROM v_old_fee THEN
    RAISE EXCEPTION 'Trial fee cannot be changed after the trial is converted — the student''s first payment was already adjusted by ₹%', v_old_fee
      USING ERRCODE = '22023';
  END IF;

  UPDATE trials SET
    name           = CASE WHEN p_payload ? 'name'          THEN p_payload->>'name'                              ELSE name           END,
    phone          = CASE WHEN p_payload ? 'phone'         THEN p_payload->>'phone'                             ELSE phone          END,
    parent         = CASE WHEN p_payload ? 'parent'        THEN p_payload->>'parent'                            ELSE parent         END,
    age            = CASE WHEN p_payload ? 'age'           THEN NULLIF(p_payload->>'age','')::INTEGER           ELSE age            END,
    sport          = CASE WHEN p_payload ? 'sport'         THEN p_payload->>'sport'                             ELSE sport          END,
    status         = CASE WHEN p_payload ? 'status'        THEN p_payload->>'status'                            ELSE status         END,
    stage          = CASE WHEN p_payload ? 'stage'         THEN p_payload->>'stage'                             ELSE stage          END,
    converted      = CASE WHEN p_payload ? 'converted'     THEN (p_payload->>'converted')::BOOLEAN              ELSE converted      END,
    follow_up      = CASE WHEN p_payload ? 'followUp'      THEN NULLIF(p_payload->>'followUp','')::DATE          ELSE follow_up      END,
    batch_id       = CASE WHEN p_payload ? 'batchId'       THEN NULLIF(p_payload->>'batchId','')::BIGINT        ELSE batch_id       END,
    trial_date     = CASE WHEN p_payload ? 'trialDate'     THEN (p_payload->>'trialDate')::DATE                 ELSE trial_date     END,
    trial_sessions = CASE WHEN p_payload ? 'trialSessions' THEN (p_payload->>'trialSessions')::INTEGER          ELSE trial_sessions END,
    sessions_done  = CASE WHEN p_payload ? 'sessionsDone'  THEN (p_payload->>'sessionsDone')::INTEGER           ELSE sessions_done  END,
    coach_note     = CASE WHEN p_payload ? 'coachNote'     THEN NULLIF(p_payload->>'coachNote','')              ELSE coach_note     END,
    coach_rec      = CASE WHEN p_payload ? 'coachRec'      THEN NULLIF(p_payload->>'coachRec','')               ELSE coach_rec      END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN NULLIF(p_payload->>'notes','')                  ELSE notes          END,
    quoted_fee     = CASE WHEN p_payload ? 'quotedFee'     THEN NULLIF(p_payload->>'quotedFee','')::NUMERIC     ELSE quoted_fee     END,
    session_start  = CASE WHEN p_payload ? 'sessionStart'  THEN NULLIF(p_payload->>'sessionStart','')::TIME      ELSE session_start  END,
    session_end    = CASE WHEN p_payload ? 'sessionEnd'    THEN NULLIF(p_payload->>'sessionEnd','')::TIME        ELSE session_end    END,
    dob            = CASE WHEN p_payload ? 'dob'           THEN NULLIF(p_payload->>'dob','')::DATE              ELSE dob            END,
    age_group      = CASE WHEN p_payload ? 'ageGroup'      THEN NULLIF(p_payload->>'ageGroup','')               ELSE age_group      END,
    program_type   = CASE WHEN p_payload ? 'programType'   THEN COALESCE(NULLIF(p_payload->>'programType',''),'academy') ELSE program_type END,
    trial_fee_paid = CASE WHEN p_payload ? 'trialFeePaid'  THEN (p_payload->>'trialFeePaid')::NUMERIC           ELSE trial_fee_paid END,
    trial_fee_mode = CASE WHEN p_payload ? 'trialFeeMode'  THEN COALESCE(NULLIF(p_payload->>'trialFeeMode',''),'Not collected') ELSE trial_fee_mode END
  WHERE id = p_trial_id;

  -- ── Sync the booked payment ──
  SELECT trial_fee_paid, COALESCE(trial_fee_mode,'Not collected'), trial_date, sport, name, branch_id
    INTO v_new_fee, v_mode, v_date, v_sport, v_name, v_branch
  FROM trials WHERE id = p_trial_id;

  SELECT id, student_id INTO v_pay_id, v_pay_student
  FROM payments WHERE trial_id = p_trial_id;

  v_should_book := (COALESCE(v_new_fee,0) > 0 AND v_mode <> 'Not collected');

  IF v_should_book AND v_pay_id IS NOT NULL THEN
    UPDATE payments SET
      amount = v_new_fee,
      date   = v_date,
      month  = to_char(v_date, 'Mon YYYY'),
      mode   = v_mode,
      sport  = v_sport,
      student = v_name,
      notes  = 'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    WHERE id = v_pay_id;

  ELSIF v_should_book AND v_pay_id IS NULL THEN
    -- Lazy create: fee went 0 → N, or the trial predates this migration.
    v_receipt := next_trial_receipt_id();
    INSERT INTO payments (
      id, student_id, student, amount, month, date, status, mode,
      payment_type, discount_pct, months_covered, academy_id,
      trial_id, branch_id, sport, notes
    ) VALUES (
      v_receipt, NULL, v_name, v_new_fee,
      to_char(v_date, 'Mon YYYY'), v_date, 'Paid', v_mode,
      'trial', 0, 1, v_trial_academy,
      p_trial_id, v_branch, v_sport,
      'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    );
    UPDATE trials SET receipt_no = v_receipt WHERE id = p_trial_id;

  ELSIF NOT v_should_book AND v_pay_id IS NOT NULL THEN
    -- Fee cleared or marked 'Not collected'. Only safe to remove while
    -- the row is still unlinked — a linked row belongs to a student's
    -- ledger and the converted-guard above should have prevented this.
    IF v_pay_student IS NULL THEN
      DELETE FROM payments WHERE id = v_pay_id;
      UPDATE trials SET receipt_no = NULL WHERE id = p_trial_id;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_update_trial(bigint, jsonb, text) TO anon, authenticated;

COMMIT;
