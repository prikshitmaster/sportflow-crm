-- Student profile photos bucket — run this in Supabase SQL Editor

-- 1. Add photo_url column
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Create bucket (public = true enables CDN reads without policies)
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Drop ALL existing policies for this bucket (clean slate)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
    AND (policyname LIKE '%student-photos%' OR policyname LIKE '%student_photos%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- 4. Single permissive policy — allow ALL operations for ALL roles
--    (students use custom auth, not Supabase JWT, so anon key must be allowed)
CREATE POLICY "student-photos open access"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'student-photos')
  WITH CHECK (bucket_id = 'student-photos');
