-- Create a public bucket for student profile photos
-- Run this in Supabase SQL Editor

-- 1. Add photo_url column (safe to run even if already done)
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Create the bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop old policies if they exist (safe re-run)
DROP POLICY IF EXISTS "student-photos public read"      ON storage.objects;
DROP POLICY IF EXISTS "student-photos authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "student-photos authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "student-photos anon upload"      ON storage.objects;
DROP POLICY IF EXISTS "student-photos anon update"      ON storage.objects;

-- 3. Allow anyone to read (public CDN)
CREATE POLICY "student-photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'student-photos');

-- 4. Allow anyone to upload (students use custom auth, not Supabase auth)
CREATE POLICY "student-photos anon upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'student-photos');

-- 5. Allow anyone to overwrite (upsert)
CREATE POLICY "student-photos anon update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'student-photos');
