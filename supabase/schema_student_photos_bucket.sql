-- Create a public bucket for student profile photos
-- Run this in Supabase SQL Editor

-- 1. Add photo_url column (safe to run even if already done)
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Create the bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Allow anyone to read (public CDN)
CREATE POLICY "student-photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'student-photos');

-- 4. Allow authenticated users (staff/owner) to upload
CREATE POLICY "student-photos authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'student-photos');

-- 5. Allow authenticated users to overwrite/update
CREATE POLICY "student-photos authenticated update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'student-photos');
