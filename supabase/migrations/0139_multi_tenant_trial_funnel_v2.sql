-- ============================================================
-- 0139 — Multi-tenant public trial funnel (v2, slug-resolved)
-- ============================================================
-- WHAT
--   • _public_trial_academy_id_v2(p_slug)      — resolves academy_id from
--     academies.slug instead of a hardcoded constant.
--   • secure_public_trial_branches_v2(p_slug)
--   • secure_public_trial_batches_v2(p_slug, p_branch_id)
--   • secure_submit_public_trial_v2(p_slug, p_branch_id, ...)
--     — identical bodies to the originals in 0136/0137, verified against
--     the LIVE function definitions via pg_get_functiondef before writing
--     this (not reconstructed from the migration files, which have
--     previously been wrong about live signatures — see
--     [[sportflow-migration-verification-gotchas]] equivalent note in this
--     repo's own history). Only change: academy resolution source.
--   • secure_public_academy_branding(p_slug) — NEW, pre-auth (no
--     auth.uid() check) since this is public marketing content (name,
--     logo, brand color) shown before the OTP screen even renders.
--     Deliberately a narrow explicit column list, never SELECT * —
--     academies also holds owner_id and join_code (a staff-signup
--     secret), neither of which may ever be reachable pre-auth.
--
-- WHY NEW NAMES, NOT IN-PLACE REPLACEMENT (explicit choice, not default)
--   The original zero-arg RPCs are LIVE and used by the bare /join route,
--   which is itself permanently kept (enroll-app/capacitor.config.ts has
--   that exact URL baked into an already-built APK). Replacing them
--   in-place would risk a real prospect mid-registration hitting a
--   "function signature changed under me" error during the deploy window
--   between this migration landing and the frontend redeploy finishing.
--   Shipping under _v2 names means the originals keep working, completely
--   untouched, until a separate follow-up migration drops them — only
--   once the frontend is confirmed live and calling _v2 successfully.
--
-- SECURITY INVARIANT UNCHANGED FROM 0136/0137
--   No client-supplied academy/branch/batch id is ever trusted directly.
--   phone is still always derived from auth.users via auth.uid(), never a
--   parameter. Only the "which academy" resolution source changed
--   (hardcoded constant -> slug lookup) — every downstream
--   validate-then-reject check is identical.
--
-- IDEMPOTENT — safe to re-run. Does NOT touch the original 0136/0137
-- functions at all.
-- ============================================================

BEGIN;

-- ── 1. Slug-resolving academy id helper ───────────────────────
CREATE OR REPLACE FUNCTION _public_trial_academy_id_v2(p_slug TEXT)
RETURNS UUID
LANGUAGE SQL STABLE
AS $$
  SELECT id FROM academies WHERE slug = lower(trim(p_slug))
$$;

-- ── 2. secure_public_trial_branches_v2 ────────────────────────
CREATE OR REPLACE FUNCTION secure_public_trial_branches_v2(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT id, sport_name, branch_name, photo_url
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches_v2(TEXT) TO anon, authenticated;

-- ── 3. secure_public_trial_batches_v2 ─────────────────────────
CREATE OR REPLACE FUNCTION secure_public_trial_batches_v2(p_slug TEXT, p_branch_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_academy UUID;
  v_sport   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id_v2(p_slug) THEN
    RAISE EXCEPTION 'invalid branch' USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT
        b.id, b.name, b.days, b.start_time, b.end_time,
        b.capacity, b.waitlist,
        GREATEST(0, b.capacity - COALESCE(cnt.n, 0)) AS seats_left
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, COUNT(*) AS n
        FROM student_batches
        GROUP BY batch_id
      ) cnt ON cnt.batch_id = b.id
      WHERE b.branch_id = p_branch_id
        AND b.academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(b.sports) s WHERE lower(s) = lower(v_sport))
      ORDER BY b.name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_batches_v2(TEXT, UUID) TO anon, authenticated;

-- ── 4. secure_submit_public_trial_v2 ──────────────────────────
CREATE OR REPLACE FUNCTION secure_submit_public_trial_v2(
  p_slug                     TEXT,
  p_branch_id                UUID,
  p_batch_id                 BIGINT DEFAULT NULL,
  p_name                     TEXT   DEFAULT NULL,
  p_parent_name              TEXT   DEFAULT NULL,
  p_emergency_contact_name   TEXT   DEFAULT NULL,
  p_emergency_contact_phone  TEXT   DEFAULT NULL,
  p_dob                      DATE   DEFAULT NULL,
  p_age                      INT    DEFAULT NULL,
  p_medical_notes            TEXT   DEFAULT NULL,
  p_document_path            TEXT   DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_phone   TEXT;
  v_academy UUID;
  v_sport   TEXT;
  v_id      BIGINT;
  v_name    TEXT;
  v_parent  TEXT;
BEGIN
  -- Only real gate that matters: a completed phone-OTP Supabase Auth session.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Phone is always the server-verified OTP number, never a client param.
  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  -- Resolve academy/sport from the branch id and reject anything that
  -- doesn't match the academy this slug resolves to — the cross-tenant guard.
  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id_v2(p_slug) THEN
    RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
  END IF;

  -- If a batch was picked, verify it actually belongs to this
  -- branch+academy+sport before accepting it.
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

  v_name   := NULLIF(TRIM(p_name), '');
  v_parent := NULLIF(TRIM(p_parent_name), '');
  IF v_name IS NULL OR v_parent IS NULL THEN
    RAISE EXCEPTION 'name and parent name are required' USING ERRCODE = '22023';
  END IF;

  -- Light anti-spam guard: nothing else rate-limits this public endpoint.
  IF (
    SELECT COUNT(*) FROM trials
    WHERE phone = v_phone AND academy_id = v_academy
      AND created_at > now() - interval '1 day'
  ) >= 4 THEN
    RAISE EXCEPTION 'too many submissions — please contact the academy directly' USING ERRCODE = '22023';
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, dob, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id,
    emergency_contact_name, emergency_contact_phone, medical_notes, document_path
  ) VALUES (
    v_name, v_parent, v_phone, p_age, p_dob, v_sport, CURRENT_DATE,
    'App', 'Scheduled', 'new',
    p_batch_id, 1, 0, false, 'academy',
    590, 'Not collected', v_academy, p_branch_id,
    NULLIF(TRIM(p_emergency_contact_name), ''),
    NULLIF(TRIM(p_emergency_contact_phone), ''),
    NULLIF(TRIM(p_medical_notes), ''),
    NULLIF(TRIM(p_document_path), '')
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial_v2(
  TEXT, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT
) TO anon, authenticated;

-- ── 5. secure_public_academy_branding — NEW, pre-auth ─────────
-- No auth.uid() check: this is the funnel's hero content, rendered
-- BEFORE the phone/OTP screen. Narrow allowlist only, never SELECT * —
-- academies also has owner_id and join_code (a staff-signup secret).
CREATE OR REPLACE FUNCTION secure_public_academy_branding(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT row_to_json(x) FROM (
      SELECT name, app_display_name, logo_url, brand_color
      FROM academies
      WHERE slug = lower(trim(p_slug))
    ) x
  ); -- NULL if the slug doesn't resolve — not an exception, treated as data
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_academy_branding(TEXT) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT proname FROM pg_proc WHERE proname LIKE '%_v2' OR proname = 'secure_public_academy_branding';
-- SELECT secure_public_academy_branding('ara'); -- should return ARA's branding as JSON
-- SELECT secure_public_academy_branding('does-not-exist'); -- should return NULL, not an error
