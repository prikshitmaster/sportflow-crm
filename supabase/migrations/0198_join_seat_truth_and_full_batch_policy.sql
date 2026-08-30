-- ═══════════════════════════════════════════════════════════════════════════
-- 0198 — /join seat truth, and what happens when a batch is full
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PART 1 — the seat count on /join was wrong, and wrong in the direction that
-- costs the academy money.
--
-- secure_public_trial_batches_v2 computed:
--     seats_left = capacity - (count of ALL rows in student_batches)
--
-- with no join to students at all. Measured on live data at the time of
-- writing, of 308 student_batches rows:
--     24  point at students that no longer exist (no FK cleanup)
--    260  belong to Suspended/Inactive students
--     24  are an actually-enrolled Active student
--
-- So 92% of the "occupied" seats were phantom, and batches with one real
-- student were showing "Waitlist" to every visitor on the public funnel.
-- Families were being turned away from batches that were nearly empty.
--
-- It was also blind to students whose enrolment lives on students.batch_id
-- rather than in student_batches — which is the normal single-batch case —
-- so the same function could equally under-count and show a genuinely full
-- batch as wide open.
--
-- The app already has a canonical answer to "who is in this batch":
-- _require_batch_capacity (0184/0185) counts
--     students.batch_id = b.id OR students.batch = b.name
--   UNION
--     student_batches rows
--   ...restricted to status = 'Active'.
-- This migration reuses exactly that definition via a shared helper so the
-- public funnel and the capacity trigger can never drift apart again.
--
-- PART 2 — a full batch could still take the family's money.
--
-- secure_submit_public_trial_v2 had no capacity check whatsoever. The batch
-- card on /join rendered "Waitlist" as a label but stayed tappable, the RPC
-- accepted the booking, and TrialEnroll.runOnlinePayment opened Razorpay
-- without ever looking at what came back. Capacity was only enforced weeks
-- later when staff tried to convert the trial, at which point Trials.jsx
-- parked it as 'enquired' — with the trial fee already collected.
--
-- Two academy-level flags now decide what happens, both defaulting to the
-- old behaviour so nothing changes until an academy opts in:
--
--   join_full_batch_selectable  (default on)  — may a full batch be booked?
--   join_full_batch_payment     (default on)  — may a full batch be charged?
--
-- Enforced HERE, not just in the UI, because the client cannot be trusted and
-- because secure_book_trial_payment (0197) is the only sanctioned way a trial
-- fee reaches the ledger — it has to agree with this decision.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. One definition of "who is in this batch" ────────────────────────────
-- Mirrors _require_batch_capacity's roster query exactly. Active only: a
-- suspended student is not occupying a seat anyone else could be given.
-- Rows whose student no longer exists fall out via the join.
CREATE OR REPLACE FUNCTION public._batch_active_roster_count(p_batch_id BIGINT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INTEGER FROM (
    SELECT s.id
      FROM students s
      JOIN batches b ON b.id = p_batch_id
     WHERE s.status = 'Active'
       AND (s.batch_id = b.id OR s.batch = b.name)
    UNION
    SELECT s.id
      FROM student_batches sb
      JOIN students s ON s.id = sb.student_id
     WHERE sb.batch_id = p_batch_id
       AND s.status = 'Active'
  ) roster;
$$;

COMMENT ON FUNCTION public._batch_active_roster_count(BIGINT) IS
  'Active students occupying a seat in this batch, counting both the primary '
  'students.batch_id link and student_batches enrolments, de-duplicated. Single '
  'source of truth shared by the public /join seat count and the capacity '
  'trigger so the two can never disagree.';

REVOKE ALL ON FUNCTION public._batch_active_roster_count(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._batch_active_roster_count(BIGINT) TO anon, authenticated;

-- ── 2. Is this academy allowing full batches to be booked / charged? ───────
-- feature_flags is (academy_id, feature, enabled) with no row meaning "on",
-- matching AppContext.isFeatureOn's `features[name] !== false`.
CREATE OR REPLACE FUNCTION public._join_flag(p_academy UUID, p_flag TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM feature_flags
      WHERE academy_id = p_academy AND feature = p_flag),
    TRUE);
$$;

REVOKE ALL ON FUNCTION public._join_flag(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._join_flag(UUID, TEXT) TO anon, authenticated;

-- ── 3. Public batch list — honest seat counts ──────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_public_trial_batches_v2(
  p_slug TEXT, p_branch_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_academy UUID;
  v_sport   TEXT;
BEGIN
  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id_v2(p_slug) THEN
    RAISE EXCEPTION 'invalid branch' USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT
        b.id, b.name, b.code, b.days, b.start_time, b.end_time,
        b.capacity, b.waitlist, b.age_min, b.age_max, b.coach, b.batch_type,
        st.photo_url AS coach_photo_url,
        -- Was: capacity - count(*) over student_batches, unfiltered. See header.
        GREATEST(0, COALESCE(b.capacity, 0) - _batch_active_roster_count(b.id)) AS seats_left,
        -- So the client can render "full" without recomputing the rule, and
        -- knows whether tapping / paying is even allowed here.
        (COALESCE(b.capacity, 0) > 0
          AND _batch_active_roster_count(b.id) >= b.capacity)          AS is_full,
        _join_flag(v_academy, 'join_full_batch_selectable')            AS full_selectable,
        _join_flag(v_academy, 'join_full_batch_payment')               AS full_payable
      FROM batches b
      LEFT JOIN staff st ON st.academy_id = v_academy AND lower(st.name) = lower(b.coach)
      WHERE b.branch_id = p_branch_id
        AND b.academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(b.sports) s WHERE lower(s) = lower(v_sport))
      ORDER BY b.code, b.name
    ) x
  );
END;
$$;

-- ── 4. Submitting into a full batch ────────────────────────────────────────
-- Wraps the existing function rather than restating it: the real body is long
-- and unrelated to this change, so we add the capacity decision in front of
-- it and let it do the insert, then correct the row afterwards. Doing it in
-- one transaction means a family never sees a half-booked state.
CREATE OR REPLACE FUNCTION public._join_full_batch_decision(
  p_academy UUID, p_batch_id BIGINT,
  OUT is_full BOOLEAN, OUT allow_booking BOOLEAN, OUT allow_payment BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cap INTEGER;
BEGIN
  is_full := FALSE; allow_booking := TRUE; allow_payment := TRUE;
  IF p_batch_id IS NULL THEN RETURN; END IF;

  SELECT capacity INTO v_cap FROM batches WHERE id = p_batch_id;
  IF v_cap IS NULL OR v_cap <= 0 THEN RETURN; END IF;   -- uncapped: never full

  is_full := _batch_active_roster_count(p_batch_id) >= v_cap;
  IF NOT is_full THEN RETURN; END IF;

  allow_booking := _join_flag(p_academy, 'join_full_batch_selectable');
  allow_payment := allow_booking AND _join_flag(p_academy, 'join_full_batch_payment');
END;
$$;

REVOKE ALL ON FUNCTION public._join_full_batch_decision(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._join_full_batch_decision(UUID, BIGINT) TO anon, authenticated;

-- ── 5. Trial fee may not be booked against an unseated trial ───────────────
-- secure_book_trial_payment (0197) is the only sanctioned path a trial fee
-- takes into the payments ledger. If the trial has no seat, there is nothing
-- to charge for — refuse, so a client that ignores the UI still cannot take
-- the money. HINT lets the caller tell this apart from a real failure.
CREATE OR REPLACE FUNCTION public._assert_trial_is_seated(p_trial_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_stage TEXT;
BEGIN
  SELECT stage INTO v_stage FROM trials WHERE id = p_trial_id;
  IF v_stage = 'enquired' THEN
    RAISE EXCEPTION
      'This batch is full, so no trial fee is due. The academy will call when a seat opens.'
      USING ERRCODE = '23514', HINT = 'trial_not_seated';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_trial_is_seated(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_trial_is_seated(BIGINT) TO anon, authenticated;

-- ── 6. Clean the 24 orphaned rows ──────────────────────────────────────────
-- student_batches has no FK cleanup, so deleting a student leaves its
-- enrolment rows behind for ever. They can never become valid again — the id
-- they point at is gone — and until part 3 above they were silently eating
-- public seats. Removing them changes no seat count now (the roster helper
-- joins to students, so they are already excluded); it stops the table
-- growing a permanent tail of dead rows.
DELETE FROM student_batches sb
 WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = sb.student_id);

-- ── 7. Public submit — decide the seat before taking anyone's money ───────
-- Restated in full (rather than wrapped) because the stage and fee have to be
-- decided at INSERT time: a row that briefly exists as a payable 'new' trial
-- and is corrected afterwards is a row another session can read mid-flight.
-- Everything outside the marked block is unchanged from the previous version.
-- Parameter defaults restated exactly as they already are — CREATE OR REPLACE
-- cannot remove them, and PostgREST relies on them to allow partial argument
-- lists from the client.
CREATE OR REPLACE FUNCTION public.secure_submit_public_trial_v2(
  p_slug TEXT,
  p_branch_id UUID,
  p_batch_id BIGINT DEFAULT NULL::BIGINT,
  p_name TEXT DEFAULT NULL::TEXT,
  p_parent_name TEXT DEFAULT NULL::TEXT,
  p_emergency_contact_name TEXT DEFAULT NULL::TEXT,
  p_emergency_contact_phone TEXT DEFAULT NULL::TEXT,
  p_dob DATE DEFAULT NULL::DATE,
  p_age INTEGER DEFAULT NULL::INTEGER,
  p_medical_notes TEXT DEFAULT NULL::TEXT,
  p_document_path TEXT DEFAULT NULL::TEXT,
  p_trial_fee_mode TEXT DEFAULT 'Not collected'::TEXT,
  p_trial_fee_amount INTEGER DEFAULT NULL::INTEGER,
  p_relationship TEXT DEFAULT NULL::TEXT,
  p_sibling_of_trial_id BIGINT DEFAULT NULL::BIGINT,
  p_mother_name TEXT DEFAULT NULL::TEXT,
  p_address TEXT DEFAULT NULL::TEXT,
  p_gender TEXT DEFAULT NULL::TEXT,
  p_occupation TEXT DEFAULT NULL::TEXT,
  p_alternate_contact_phone TEXT DEFAULT NULL::TEXT,
  p_email TEXT DEFAULT NULL::TEXT,
  p_preferred_days TEXT[] DEFAULT NULL::TEXT[])
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  -- NEW
  v_full      BOOLEAN;
  v_booking   BOOLEAN;
  v_payment   BOOLEAN;
  v_stage     TEXT;
  v_fee       INTEGER;
  v_fee_mode  TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

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

  -- ══ NEW: seat decision, before anything is written ════════════════════
  SELECT d.is_full, d.allow_booking, d.allow_payment
    INTO v_full, v_booking, v_payment
    FROM _join_full_batch_decision(v_academy, p_batch_id) d;

  IF v_full AND NOT v_booking THEN
    RAISE EXCEPTION
      'This batch is full. Please pick another batch, or visit the academy and we will add you to the list.'
      USING ERRCODE = '23514', HINT = 'batch_full_not_selectable';
  END IF;

  IF v_full AND NOT v_payment THEN
    -- Seat unavailable but the academy still wants the lead: park it exactly
    -- where the staff-side conversion path already parks unseatable trials
    -- (Trials.jsx 'enquired' = wanted in, no seat free) and charge nothing.
    v_stage    := 'enquired';
    v_fee      := 0;
    v_fee_mode := 'Not collected';
  ELSE
    v_stage    := 'new';
    v_fee      := COALESCE(p_trial_fee_amount, 590);
    v_fee_mode := p_trial_fee_mode;
  END IF;
  -- ══ end new ═══════════════════════════════════════════════════════════

  SELECT NULLIF(COALESCE(array_agg(w.day ORDER BY w.ord), '{}'), '{}') INTO v_days
  FROM unnest(ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) WITH ORDINALITY AS w(day, ord)
  WHERE EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_preferred_days, '{}'::TEXT[])) x
    WHERE lower(trim(x)) = lower(w.day)
  );

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
    'App', 'Scheduled', v_stage,
    p_batch_id, 1, 0, false, 'academy',
    v_fee, v_fee_mode, v_academy, p_branch_id,
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

  BEGIN
    v_body := v_name || ' registered for ' || COALESCE(v_sport, 'a sport')
              || ' at ' || COALESCE(v_branch, 'your academy')
              || COALESCE(' · prefers ' || array_to_string(v_days, ', '), '')
              -- Says so plainly, so the office knows this one needs a callback
              -- rather than a trial slot.
              || CASE WHEN v_stage = 'enquired'
                      THEN ' — BATCH FULL, no fee taken, waiting for a seat' ELSE '' END
              || '.';

    SELECT owner_id INTO v_owner FROM academies WHERE id = v_academy;
    IF v_owner IS NOT NULL THEN
      INSERT INTO notifications (academy_id, recipient_type, recipient_id, title, body, type, link)
      VALUES (v_academy, 'owner', v_owner::TEXT, 'New Registration', v_body, 'trial', '/trials');
    END IF;

    IF v_manager IS NOT NULL THEN
      INSERT INTO notifications (academy_id, recipient_type, recipient_id, title, body, type, link)
      VALUES (v_academy, 'staff', v_manager::TEXT, 'New Registration', v_body, 'trial', '/staff/trials');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

-- ── Verify ────────────────────────────────────────────────────────────────
-- select b.name, b.capacity, _batch_active_roster_count(b.id) as occupied,
--        greatest(0, b.capacity - _batch_active_roster_count(b.id)) as seats_left
--   from batches b where b.branch_id = '<branch>' order by b.name;
