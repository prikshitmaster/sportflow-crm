-- ============================================================
-- 0100_fix_staff_photos_anon_select.sql
-- staff-photos had INSERT + UPDATE policies for anon but no SELECT.
-- Supabase Storage upsert (profile photo re-upload) needs SELECT
-- on the existing row before it can UPDATE — missing SELECT caused
-- RLS violation on every repeat upload (profile pic + document).
-- ============================================================

CREATE POLICY "staff_photos_anon_select"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'staff-photos');
