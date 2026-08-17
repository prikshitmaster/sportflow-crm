-- 0166 — Fix secure_my_trials_v1 to match the phone normalization from 0165
--
-- 0165 normalized secure_submit_public_trial_v2 so trials.phone is a bare
-- 10-digit local number instead of auth.users.phone's raw E.164-without-'+'
-- (e.g. '9979369521' instead of '919979369521'). secure_my_trials_v1 — the
-- Profile tab's "Your registrations" read RPC — was never updated to match:
-- it still compares t.phone against the UNNORMALIZED 12-digit auth phone, so
-- every trial submitted since 0165 shipped (3 hours ago) fails to match and
-- shows "Nothing registered yet" even though the trial was inserted fine.
--
-- Same fix as 0165: strip non-digits, keep the last 10.
--
-- IDEMPOTENT — safe to re-run. Signature is UNCHANGED, plain CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_my_trials_v1(p_slug TEXT)
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

  -- auth.users.phone is E.164 without the leading '+' — trials.phone is a
  -- bare 10-digit local number like everywhere else in the app (see 0165).
  v_phone := right(regexp_replace(v_phone, '\D', '', 'g'), 10);
  IF v_phone IS NULL OR length(v_phone) <> 10 THEN
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

COMMIT;
