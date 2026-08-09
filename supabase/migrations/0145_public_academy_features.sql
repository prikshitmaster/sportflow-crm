-- ============================================================
-- 0145 — Public read of the two login-related feature flags
-- ============================================================
-- WHAT
--   secure_public_academy_features(p_slug) — pre-auth, anon-readable,
--   returns ONLY { student_code_login, family_login } for the academy this
--   slug resolves to. The public /join funnel needs to know whether these
--   are on to decide which login option(s) to show a newly-converted
--   student, but it never loads AppContext (anonymous, one-shot session)
--   so it has no other way to see feature_flags.
--
--   Mirrors isFeatureOn()'s exact semantics client-side
--   (features[name] !== false) — a flag is ON unless there's an explicit
--   disabled row. Deliberately a narrow 2-key allowlist, never the whole
--   feature_flags table — an academy's other flags (payments, attendance,
--   etc.) aren't this endpoint's business, same "never SELECT *" discipline
--   as secure_public_academy_branding.
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
    RETURN json_build_object('student_code_login', true, 'family_login', true);
  END IF;

  RETURN json_build_object(
    'student_code_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'student_code_login' AND enabled = false),
    'family_login',
      NOT EXISTS (SELECT 1 FROM feature_flags WHERE academy_id = v_academy AND feature = 'family_login' AND enabled = false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_academy_features(TEXT) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT secure_public_academy_features('ara'); -- {"student_code_login":true,"family_login":true}
