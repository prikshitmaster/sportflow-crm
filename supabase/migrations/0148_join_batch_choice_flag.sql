-- ============================================================
-- 0148 — join_batch_choice flag exposed to the public /join funnel
-- ============================================================
-- WHAT
--   Adds a third key, join_batch_choice, to the existing
--   secure_public_academy_features(p_slug) allowlist (see 0145).
--
--   It controls whether the "Choose a Batch" step renders between branch
--   and registration form on /join/:slug. Off → the funnel goes straight
--   from branch to the form and the trial is submitted with no batch, i.e.
--   exactly what "Not sure yet — let the academy pick" already did, so
--   nothing downstream changes shape (trials.batch_id was always nullable).
--
--   Same semantics as every other flag and as client-side isFeatureOn():
--   ON unless there is an explicit enabled = false row. Owners flip it in
--   Settings → Features, which writes that row via toggleFeature().
--
--   Still a narrow allowlist, never SELECT * over feature_flags — an
--   academy's other flags are not this endpoint's business.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION secure_public_academy_features(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_academy UUID;
BEGIN
  SELECT id INTO v_academy FROM academies WHERE slug = lower(trim(p_slug));
  IF v_academy IS NULL THEN
    RETURN json_build_object('student_code_login', true, 'family_login', true, 'join_batch_choice', true);
  END IF;

  RETURN json_build_object(
    'student_code_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'student_code_login' AND enabled = false),
    'family_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'family_login' AND enabled = false),
    'join_batch_choice',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'join_batch_choice' AND enabled = false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_academy_features(TEXT) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT secure_public_academy_features('ara');
--   -- {"student_code_login":true,"family_login":true,"join_batch_choice":true}
--
--   -- turn the batch step off for one academy (same row toggleFeature writes):
--   INSERT INTO feature_flags (academy_id, feature, enabled)
--   VALUES ('<academy-uuid>', 'join_batch_choice', false)
--   ON CONFLICT (academy_id, feature) DO UPDATE SET enabled = false;
