-- ============================================================
-- 0125 — Trial fees as real revenue: RPCs
-- ============================================================
-- Requires 0124 (columns, unique index, TRL- sequence).
--
-- WHAT CHANGES
--   secure_insert_trial       → books the trial fee as a payments row
--                               IN THE SAME TRANSACTION; forces branch_id
--                               for staff (fixes a live bug, see below)
--   secure_update_trial       → keeps that row in sync; refuses fee edits
--                               once the trial is converted
--   secure_delete_trial       → removes the row iff it is still unlinked
--   secure_link_trial_payment → NEW; attaches the row to a student on
--                               conversion (idempotent, never inserts)
--   secure_insert_payment     → coerces 'trial' → 'monthly' (import guard)
--   secure_delete_payment     → refuses to delete trial-typed rows
--
-- WHY THE INSERT LIVES IN secure_insert_trial AND NOT secure_insert_payment
--   secure_insert_payment requires the 'payments.manage' perm. The
--   receptionist preset is ['students.view','students.manage',
--   'trials.manage'] (src/lib/permissions.js:39) — the exact role working
--   the front desk collecting the ₹590. Routing through it would throw
--   42501 on every receptionist-created trial and silently not book,
--   reproducing the bug this migration exists to fix.
--   Doing it here also makes trial+payment atomic and lets us set
--   trial_id / branch_id / sport, which secure_insert_payment cannot.
--
-- LIVE BUG FIXED IN PASSING
--   AppContext.jsx:1357 addTrial passes selectedBranch, but the scoping
--   memos use effectiveBranch (= user.branchId for staff). Staff-created
--   trials therefore got branch_id NULL and were already invisible in
--   filteredTrials. Stamping server-side (the 19_branch_required_creates
--   pattern) fixes it for trials and gives the payment row a real branch.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_insert_trial ───────────────────────────────────
-- Signature unchanged, so src/lib/db.js:612 needs no edit.
CREATE OR REPLACE FUNCTION secure_insert_trial(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Branch: staff are forced into their own branch server-side, exactly
  -- as create_student_with_payment does (19_branch_required_creates:55-57).
  v_branch := NULLIF(p_payload->>'branchId', '')::UUID;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch := a.branch_id;
  END IF;

  v_fee   := COALESCE((p_payload->>'trialFeePaid')::NUMERIC, 590);
  v_mode  := COALESCE(NULLIF(p_payload->>'trialFeeMode', ''), 'Cash');
  v_date  := (p_payload->>'trialDate')::DATE;
  v_sport := p_payload->>'sport';
  v_name  := p_payload->>'name';

  INSERT INTO trials (
    name, parent, phone, age, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, follow_up, notes,
    quoted_fee, session_start, session_end, dob, age_group, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id
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
    v_branch
  )
  RETURNING id INTO v_id;

  -- Book the fee as real revenue. student_id stays NULL until conversion;
  -- branch_id + sport let the row scope itself in the meantime.
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
      -- Standard 'Jul 2026' label. Dashboard.jsx:85-99 parses this field
      -- and falls through to `return true` on anything it cannot read,
      -- which would misfile the row into the current month.
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

GRANT EXECUTE ON FUNCTION secure_insert_trial(JSONB, TEXT) TO anon, authenticated;


-- ── 2. secure_update_trial ───────────────────────────────────
-- Keeps the booked payment in sync with the trial, including lazy
-- create (0 → N) and removal (N → 0).
CREATE OR REPLACE FUNCTION secure_update_trial(
  p_trial_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    trial_fee_mode = CASE WHEN p_payload ? 'trialFeeMode'  THEN COALESCE(NULLIF(p_payload->>'trialFeeMode',''),'Cash') ELSE trial_fee_mode END
  WHERE id = p_trial_id;

  -- ── Sync the booked payment ──
  SELECT trial_fee_paid, COALESCE(trial_fee_mode,'Cash'), trial_date, sport, name, branch_id
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

GRANT EXECUTE ON FUNCTION secure_update_trial(BIGINT, JSONB, TEXT) TO anon, authenticated;


-- ── 3. secure_delete_trial ───────────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_trial(
  p_trial_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_trial_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id INTO v_trial_academy FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial delete' USING ERRCODE = '42501';
  END IF;

  -- Unlinked lead removed → its fee leaves revenue with it.
  -- Already converted → the payment belongs to the student's ledger;
  -- keep it and let the FK null out trial_id.
  DELETE FROM payments WHERE trial_id = p_trial_id AND student_id IS NULL;

  DELETE FROM trials WHERE id = p_trial_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_trial(BIGINT, TEXT) TO anon, authenticated;


-- ── 4. secure_link_trial_payment (NEW) ───────────────────────
-- Called after create_student_with_payment on conversion. Only ever
-- UPDATEs — it can never insert, so it cannot double-book.
--
-- Deliberately NOT folded into create_student_with_payment: that
-- function already takes 27 args and adding one requires DROP FUNCTION
-- on the full old signature, which is too much blast radius on the most
-- critical write path in the app. The failure mode here is benign — the
-- row keeps student_id NULL and is STILL counted in revenue, just
-- unattributed to a student.
--
-- Returns the amount actually booked so the client can warn if it
-- disagrees with the amount it deducted from the first month.
CREATE OR REPLACE FUNCTION secure_link_trial_payment(
  p_trial_id   BIGINT,
  p_student_id BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_trial_academy   UUID;
  v_student_academy UUID;
  v_amount          NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  -- Either perm suffices: conversion is done by whoever manages trials
  -- or students. Notably NOT payments.manage — see the header note.
  -- There is no _has_perm helper (only the raising _require_perm at
  -- 0033:96), so the same semantics are inlined here for the OR case.
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden: students cannot perform this action' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind <> 'owner'
     AND NOT (a.perms ? 'trials.manage' OR a.perms ? 'students.manage') THEN
    RAISE EXCEPTION 'forbidden: trials.manage or students.manage required'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_trial_academy   FROM trials   WHERE id = p_trial_id;
  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;

  IF v_trial_academy IS NULL OR v_student_academy IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id
     OR v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy link blocked' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: the student_id IS NULL guard means a re-run is a no-op.
  UPDATE payments
     SET student_id = p_student_id
   WHERE trial_id = p_trial_id
     AND student_id IS NULL;

  -- Read back unconditionally, so a re-run (row already linked) still
  -- reports the booked amount instead of NULL and does not trip the
  -- client's mismatch warning.
  SELECT amount INTO v_amount FROM payments WHERE trial_id = p_trial_id;

  RETURN v_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_link_trial_payment(BIGINT, BIGINT, TEXT) TO anon, authenticated;


-- ── 5. secure_insert_payment — import guard ──────────────────
-- exportImport.js:844 round-trips payment_type straight through. Now
-- that the CHECK allows 'trial', an import could mint a trial-typed row
-- with a student_id and NO trial_id, sidestepping payments_trial_id_uniq
-- entirely and double-booking. Trial rows may only originate from
-- secure_insert_trial / secure_update_trial.
CREATE OR REPLACE FUNCTION secure_insert_payment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_academy_id      UUID;
  v_payment_id      TEXT;
  v_student_id      BIGINT;
  v_student_academy UUID;
  v_payment_type    TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id INTO v_student_academy FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  -- 'custom' is a UI-only concept; 'trial' is reserved for trial-originated
  -- rows. Both normalise to 'monthly' here.
  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start,
    academy_id, notes
  ) VALUES (
    v_payment_id,
    v_student_id,
    p_payload->>'student',
    NULLIF(p_payload->>'amount','')::NUMERIC,
    p_payload->>'month',
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    v_payment_type,
    COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0),
    COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1),
    NULLIF(p_payload->>'coverageStart','')::DATE,
    v_academy_id,
    p_payload->>'notes'
  );

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_payment(JSONB, TEXT) TO anon, authenticated;


-- ── 6. secure_delete_payment — protect trial rows ────────────
-- Deleting the payment would leave trials.trial_fee_paid claiming money
-- that is no longer booked, permanently desyncing the reconciliation
-- query. The fee must be removed from the Trial record instead, which
-- routes through secure_update_trial and keeps both sides consistent.
CREATE OR REPLACE FUNCTION secure_delete_payment(
  p_payment_id TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                RECORD;
  v_pay_academy    UUID;
  v_student_branch UUID;
  v_payment_type   TEXT;
  v_trial_id       BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT COALESCE(p.academy_id, s.academy_id), s.branch_id, p.payment_type, p.trial_id
    INTO v_pay_academy, v_student_branch, v_payment_type, v_trial_id
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;
  IF v_pay_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  IF v_payment_type = 'trial' OR v_trial_id IS NOT NULL THEN
    RAISE EXCEPTION 'This is a trial fee receipt — remove the fee from the Trial record instead so both stay in sync'
      USING ERRCODE = '42501';
  END IF;

  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  DELETE FROM payments WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_payment(TEXT, TEXT) TO anon, authenticated;
