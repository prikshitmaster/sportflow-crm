-- ============================================================
-- 0026_session_active_status_ground_photo.sql
-- Adds 'active' phase to session lifecycle + ground photo upload
-- SAFE: all ALTER ... IF NOT EXISTS / IF EXISTS
-- ============================================================

-- 1. Allow 'active' status on session_plans
ALTER TABLE session_plans DROP CONSTRAINT IF EXISTS session_plans_status_check;
ALTER TABLE session_plans ADD CONSTRAINT session_plans_status_check
  CHECK (status IN ('draft', 'published', 'active', 'completed'));

-- 2. Ground photo URL column
ALTER TABLE session_plans ADD COLUMN IF NOT EXISTS ground_photo_url text;

-- 3. Storage bucket for ground/pitch photos (public read)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('session-photos', 'session-photos', true)
  ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read session photos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'session_photos_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "session_photos_read" ON storage.objects
        FOR SELECT USING (bucket_id = 'session-photos')
    $policy$;
  END IF;
END$$;

-- Allow any insert (app-layer auth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'session_photos_write'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "session_photos_write" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'session-photos')
    $policy$;
  END IF;
END$$;

-- Allow updates (re-upload photo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'session_photos_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "session_photos_update" ON storage.objects
        FOR UPDATE USING (bucket_id = 'session-photos')
    $policy$;
  END IF;
END$$;
