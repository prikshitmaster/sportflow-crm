-- 0076 — private 'backups' bucket + owner-only read (signed URLs).
-- Path convention: {academy_id}/{YYYY-MM-DD}.xlsx
-- Writes happen only via the service role (weekly-backup edge function), which
-- bypasses RLS — so no INSERT/UPDATE/DELETE policy is granted here.
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Owner (authenticated) may READ only their own academy's backup objects.
-- The first path folder is the academy_id; get_my_academy_id() resolves the
-- owner's academy from auth.uid().
DROP POLICY IF EXISTS backups_owner_read ON storage.objects;
CREATE POLICY backups_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'backups'
    AND (storage.foldername(name))[1] = get_my_academy_id()::text
  );

COMMIT;
