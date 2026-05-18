-- ============================================================
-- 0022_session_builder.sql
-- Extends session planner: diagram presets, completed status,
-- storage bucket for drill images
-- SAFE: all ALTER ... IF NOT EXISTS / IF EXISTS
-- ============================================================

-- 1. Diagram preset column on drills (for SVG zone picker)
ALTER TABLE drills ADD COLUMN IF NOT EXISTS diagram_preset text;

-- 2. Allow 'completed' status on session_plans
--    Drop old check, recreate with three values
ALTER TABLE session_plans DROP CONSTRAINT IF EXISTS session_plans_status_check;
ALTER TABLE session_plans ADD CONSTRAINT session_plans_status_check
  CHECK (status IN ('draft', 'published', 'completed'));

ALTER TABLE session_plans ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3. Storage bucket for drill diagram images (public reads, auth writes)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('drill-diagrams', 'drill-diagrams', true)
  ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'drill_diagrams_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "drill_diagrams_read" ON storage.objects
        FOR SELECT USING (bucket_id = 'drill-diagrams')
    $policy$;
  END IF;
END$$;

-- Allow any insert (app-layer auth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'drill_diagrams_write'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "drill_diagrams_write" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'drill-diagrams')
    $policy$;
  END IF;
END$$;
