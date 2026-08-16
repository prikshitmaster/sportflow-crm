-- 0162 — Auto-assign batch (and its coach) by age on /join
--
-- New toggle, same feature_flags mechanism as join_batch_choice (0148):
--   'auto_assign_batch_by_age' — OPT-IN, defaults OFF (unlike the other
--   three flags here, which default ON/"already the way it works"). This
--   is new behaviour that silently picks a batch for the family, so an
--   academy has to turn it on deliberately rather than getting it for free.
--
-- Only meaningful when join_batch_choice is OFF — when the manual picker
-- step is showing, the parent is already choosing, and this flag doesn't
-- change that. When the picker is off, this is what fills the gap: instead
-- of just collecting preferredDays for staff to sort out later, the funnel
-- matches age_min/age_max client-side (TrialEnroll.jsx) and shows the
-- matched batch's coach. That match needs the batches list even when the
-- picker step itself never shows — this migration is what makes the data
-- available to fetch in that case (age range + coach + coach photo, added
-- to secure_public_trial_batches_v2's existing payload).
--
-- batch_type is added to the payload too so the client can restrict
-- auto-matching to Development batches only, same rule Students.jsx's Add
-- Student already enforces (0157/registration-scope work) — Advance squads
-- are earned via Edit Student, never handed out at registration, automatic
-- or manual.
--
-- Coach lookup is case-insensitive LEFT JOIN on staff.name (batches.coach
-- is a plain text column, not a FK — same as fetchBatchCoachInfo's pattern
-- for the student portal, db.js:504) — done here in the RPC rather than a
-- second round-trip so the anon /join session never touches staff/batches
-- tables directly (every other public read on this funnel already goes
-- through a secure_public_* RPC, never a raw client-side select).
--
-- Both function signatures UNCHANGED — plain CREATE OR REPLACE, no DROP,
-- no PostgREST overload risk. Every existing check preserved exactly.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ── 1. secure_public_academy_features — add the new flag ──
CREATE OR REPLACE FUNCTION public.secure_public_academy_features(p_slug text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_academy UUID;
BEGIN
  SELECT id INTO v_academy FROM academies WHERE slug = lower(trim(p_slug));
  IF v_academy IS NULL THEN
    RETURN json_build_object(
      'student_code_login', true, 'family_login', true, 'join_batch_choice', true,
      'auto_assign_batch_by_age', false
    );
  END IF;

  RETURN json_build_object(
    'student_code_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'student_code_login' AND enabled = false),
    'family_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'family_login' AND enabled = false),
    'join_batch_choice',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'join_batch_choice' AND enabled = false),
    'auto_assign_batch_by_age',
      EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'auto_assign_batch_by_age' AND enabled = true)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_public_academy_features(text) TO anon, authenticated;

-- ── 2. secure_public_trial_batches_v2 — add age range + coach + coach photo ──
CREATE OR REPLACE FUNCTION public.secure_public_trial_batches_v2(p_slug text, p_branch_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
        GREATEST(0, b.capacity - COALESCE(cnt.n, 0)) AS seats_left
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, COUNT(*) AS n
        FROM student_batches
        GROUP BY batch_id
      ) cnt ON cnt.batch_id = b.id
      LEFT JOIN staff st ON st.academy_id = v_academy AND lower(st.name) = lower(b.coach)
      WHERE b.branch_id = p_branch_id
        AND b.academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(b.sports) s WHERE lower(s) = lower(v_sport))
      ORDER BY b.code, b.name
    ) x
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_public_trial_batches_v2(text, uuid) TO anon, authenticated;

COMMIT;
