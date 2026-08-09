-- ============================================================
-- 0144 — Link a converted trial to its resulting student, and
-- surface coach/batch/account detail on the public Profile tab
-- ============================================================
-- WHAT
--   • trials.converted_student_id BIGINT REFERENCES students(id) — there
--     was previously NO way to find "which student did this trial become"
--     (students.from_trial is just a boolean, no back-reference). Set at
--     the exact moment secure_link_trial_payment already runs during
--     conversion (Trials.jsx handleConvert -> addStudent -> linkTrialPayment)
--     — no new call site needed, just one more field on an existing write.
--   • secure_link_trial_payment — SAME signature (3 args), plain
--     CREATE OR REPLACE. Adds the converted_student_id UPDATE alongside
--     the existing payments UPDATE. Still idempotent: re-running with the
--     same ids is a harmless no-op either way.
--   • secure_my_trials_v1 — SAME signature (p_slug only), plain
--     CREATE OR REPLACE. Now also returns:
--       - coach_note, coach_rec (already real, staff-entered fields —
--         safe to show the parent; the SEPARATE internal "notes" column
--         staff use to track a lead is deliberately NOT exposed here)
--       - batch name/days/times, if a batch was actually assigned
--       - student_code, join_code, account_status — ONLY once
--         converted_student_id is set, i.e. a real student account exists.
--         join_code is NULLed by secure_activate_student_account once used,
--         so an already-activated student naturally shows no code (handled
--         client-side, not a new server rule).
--
-- Both signatures verified against the LIVE functions via
-- pg_get_functiondef before writing this (per this codebase's established
-- rule) — neither changed argument lists, so no DROP is needed for either.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New column ──────────────────────────────────────────
ALTER TABLE trials ADD COLUMN IF NOT EXISTS converted_student_id BIGINT REFERENCES students(id) ON DELETE SET NULL;

-- ── 2. secure_link_trial_payment — also set the back-link ──
CREATE OR REPLACE FUNCTION secure_link_trial_payment(p_trial_id BIGINT, p_student_id BIGINT, p_token TEXT DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a                 RECORD;
  v_trial_academy   UUID;
  v_student_academy UUID;
  v_amount          NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

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

  UPDATE payments
     SET student_id = p_student_id
   WHERE trial_id = p_trial_id
     AND student_id IS NULL;

  -- The actual "which student did this trial become" back-link — powers
  -- the public Profile tab's joining-code/activation display.
  UPDATE trials SET converted_student_id = p_student_id WHERE id = p_trial_id;

  SELECT amount INTO v_amount FROM payments WHERE trial_id = p_trial_id;

  RETURN v_amount;
END;
$$;

-- ── 3. secure_my_trials_v1 — richer detail for the Profile tab ─
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
        t.coach_note, t.coach_rec,
        sb.branch_name,
        b.name AS batch_name, b.days AS batch_days,
        b.start_time AS batch_start_time, b.end_time AS batch_end_time,
        s.student_code, s.join_code, s.account_status
      FROM trials t
      LEFT JOIN sport_branches sb ON sb.id = t.branch_id
      LEFT JOIN batches        b  ON b.id  = t.batch_id
      LEFT JOIN students       s  ON s.id  = t.converted_student_id
      WHERE t.phone = v_phone AND t.academy_id = v_academy
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_my_trials_v1(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT proname FROM pg_proc WHERE proname IN ('secure_link_trial_payment','secure_my_trials_v1');
