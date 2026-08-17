-- 0168 — Persist trial tax breakdown; expose academy contact info publicly
--
-- WHAT WAS WRONG
--   trials.tax_percent / tax_amount exist (0154) specifically to record the
--   GST portion of a collected trial fee, but nothing ever wrote them:
--     - secure_insert_trial / secure_update_trial only ever wrote the final
--       tax-INCLUSIVE trial_fee_paid total — Trials.jsx's TrialModal and
--       CollectFeeModal both compute the breakdown client-side (computeTax)
--       for the on-screen suggestion and the immediately-printed slip, then
--       throw it away instead of saving it.
--     - razorpay-verify-trial-payment (the /join online-payment path) never
--       computed or wrote a breakdown either.
--   Net effect: any receipt built later than the moment of collection (e.g.
--   the /join Profile tab's new "Download Receipt") had no tax line to show,
--   even when GST was genuinely charged — confirmed on trial #165 (Vikram
--   Verma, Football @ ARA SG Highway, 12% tax_on_trial): trial_fee_paid=661
--   is exactly 590 × 1.12, but tax_percent/tax_amount were both NULL.
--
-- FIX
--   1. secure_update_trial / secure_insert_trial accept optional taxPercent/
--      taxAmount and persist them with the same CASE WHEN convention as
--      every other field — callers that don't send them leave the column
--      untouched, so this can't clobber anything.
--   2. One-time backfill: for already-collected trials with tax_percent
--      still NULL, reverse-derive base/tax from the CURRENT branch trial-tax
--      rate — the exact formula CollectFeeModal's post-save receipt slip
--      already uses and staff already see and trust today
--      (total = base × (1 + pct/100) ⟹ base = total ÷ (1 + pct/100)).
--      Only applied where the branch currently has trial tax configured;
--      untaxed branches are left NULL, not fabricated.
--   3. secure_public_academy_branding additionally exposes contact_phone,
--      contact_email, address, city, state, gstin — all owner-entered in
--      Settings ("Shown on receipts") but never actually reachable from the
--      public /join funnel before now. A GSTIN is legally meant to be shown
--      on a tax invoice, so this is not a new exposure, it's the funnel
--      catching up to what Settings already promised.
--
-- Signatures UNCHANGED on all three functions — plain CREATE OR REPLACE.
-- IDEMPOTENT — safe to re-run (backfill only touches rows still NULL).

BEGIN;

-- ── 1a. secure_insert_trial — add tax_percent/tax_amount ─────
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
    emergency_contact_name, emergency_contact_phone, medical_notes,
    tax_percent, tax_amount
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
    NULLIF(trim(p_payload->>'medicalNotes'), ''),
    NULLIF(p_payload->>'taxPercent', '')::NUMERIC,
    NULLIF(p_payload->>'taxAmount', '')::NUMERIC
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

-- ── 1b. secure_update_trial — add tax_percent/tax_amount ─────
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
    trial_fee_mode = CASE WHEN p_payload ? 'trialFeeMode'  THEN COALESCE(NULLIF(p_payload->>'trialFeeMode',''),'Not collected') ELSE trial_fee_mode END,
    tax_percent    = CASE WHEN p_payload ? 'taxPercent'    THEN NULLIF(p_payload->>'taxPercent','')::NUMERIC    ELSE tax_percent    END,
    tax_amount     = CASE WHEN p_payload ? 'taxAmount'     THEN NULLIF(p_payload->>'taxAmount','')::NUMERIC     ELSE tax_amount     END
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
    IF v_pay_student IS NULL THEN
      DELETE FROM payments WHERE id = v_pay_id;
      UPDATE trials SET receipt_no = NULL WHERE id = p_trial_id;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_update_trial(bigint, jsonb, text) TO anon, authenticated;

-- ── 2. Backfill already-collected trials missing a tax breakdown ──
-- Reverse-derives base/tax from the CURRENT branch trial-tax rate — the
-- same math CollectFeeModal already shows staff on the post-collection
-- receipt slip today. Only touches rows still NULL; only where the branch
-- currently has trial tax configured (no fabrication otherwise).
UPDATE trials t
SET tax_percent = sb.tax_percent,
    tax_amount  = t.trial_fee_paid - ROUND(t.trial_fee_paid / (1 + sb.tax_percent / 100))
FROM sport_branches sb
WHERE t.branch_id = sb.id
  AND t.trial_fee_mode <> 'Not collected'
  AND t.trial_fee_paid > 0
  AND t.tax_percent IS NULL
  AND sb.tax_on_trial = TRUE
  AND sb.tax_percent > 0;

-- ── 3. secure_public_academy_branding — expose contact info ──
CREATE OR REPLACE FUNCTION public.secure_public_academy_branding(p_slug text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN (
    SELECT row_to_json(x) FROM (
      SELECT name, app_display_name, logo_url, brand_color,
             contact_phone, contact_email, address, city, state, gstin
      FROM academies
      WHERE slug = lower(trim(p_slug))
    ) x
  ); -- NULL if the slug doesn't resolve — not an exception, treated as data
END;
$$;

COMMIT;
