-- ============================================================
-- 0137 — Branch photos
-- ============================================================
-- WHAT
--   • sport_branches.photo_url — a photo the owner uploads per branch,
--     shown to prospects picking a branch in the public /join funnel
--     (previously plain text rows).
--   • storage bucket 'branch-photos' — same pattern as student-photos/
--     staff-photos: public bucket, fixed path `${branchId}.jpg`, upsert
--     overwrites cleanly (no orphaned files).
--   • secure_insert_sport_branch / secure_update_sport_branch gain
--     p_photo_url. Both changed their argument list, so (per the
--     precedent in 0065_branch_manager.sql) the OLD-signature function
--     must be dropped first — CREATE OR REPLACE only replaces a function
--     with the exact same argument types; a different arg count creates
--     a second overload instead, which is the ambiguous-function trap
--     0116 had to undo. PostgREST/Supabase RPC calls use named JSON
--     arguments (see db.js), so existing callers that don't pass
--     p_photo_url are unaffected — it defaults to NULL.
--   • secure_public_trial_branches (0136) now also returns photo_url —
--     same signature (no args), so a plain CREATE OR REPLACE is enough,
--     no DROP needed there.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. New column ──────────────────────────────────────────
ALTER TABLE sport_branches ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ── 2. Storage bucket ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('branch-photos', 'branch-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'branch-photos open access'
  ) THEN
    CREATE POLICY "branch-photos open access"
      ON storage.objects
      FOR ALL
      USING (bucket_id = 'branch-photos')
      WITH CHECK (bucket_id = 'branch-photos');
  END IF;
END $$;

-- ── 3. secure_insert_sport_branch — add p_photo_url ────────
DROP FUNCTION IF EXISTS secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_insert_sport_branch(
  p_sport_name  TEXT,
  p_branch_name TEXT,
  p_address     TEXT DEFAULT NULL,
  p_photo_url   TEXT DEFAULT NULL,
  p_token       TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_row sport_branches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sport_branches (academy_id, sport_name, branch_name, address, photo_url)
  VALUES (a.academy_id, p_sport_name, p_branch_name, NULLIF(p_address,''), NULLIF(p_photo_url,''))
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_sport_branch(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 4. secure_update_sport_branch — add p_photo_url ────────
-- p_branch_id is UUID, not BIGINT — sport_branches.id is uuid (0016b), and
-- the live function already matches that; verified directly against the
-- live column type before writing this, not assumed from an older migration
-- file (0065's own p_branch_id BIGINT was itself wrong and never applied —
-- confirmed by checking the actual live function signature).
DROP FUNCTION IF EXISTS secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id   UUID,
  p_branch_name TEXT    DEFAULT NULL,
  p_address     TEXT    DEFAULT NULL,
  p_manager_id  BIGINT  DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Verify that the chosen manager belongs to this academy
  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM staff WHERE id = p_manager_id AND academy_id = a.academy_id
    ) THEN
      RAISE EXCEPTION 'forbidden: manager not in academy' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE sport_branches SET
    branch_name = COALESCE(p_branch_name, branch_name),
    address     = p_address,
    manager_id  = p_manager_id,
    photo_url   = p_photo_url
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO anon, authenticated;

-- ── 5. secure_public_trial_branches — return photo_url too ─
-- Same signature (no args) — plain CREATE OR REPLACE, no DROP needed.
CREATE OR REPLACE FUNCTION secure_public_trial_branches()
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
      WHERE academy_id = _public_trial_academy_id()
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches() TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sport_branches' AND column_name = 'photo_url';
-- SELECT id, public FROM storage.buckets WHERE id = 'branch-photos';
-- SELECT proname, pronargs FROM pg_proc WHERE proname IN ('secure_insert_sport_branch','secure_update_sport_branch');
