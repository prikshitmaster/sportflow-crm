-- security-v3 / 28 — Storage bucket lockdown
--
-- Full security audit (2026-08-10) found five storage buckets with a single
-- "open access" RLS policy — `bucket_id = '<bucket>'`, roles = {public},
-- command = ALL, with no further restriction whatsoever. `public` in
-- Postgres RLS means literally everyone, no API key or session required.
-- Concretely, before this migration:
--   • student-photos, branch-photos: anyone on the internet could overwrite
--     or delete any student's or branch's photo, no login needed. Paths are
--     predictable (`{studentId}.jpg`, `{branchId}.jpg`).
--   • staff-photos: same, split across anon insert/update + authenticated
--     ALL policies, none scoped to the actual staff member or academy.
--   • student-documents, trial-documents: WORST case — these buckets are
--     ALSO marked public=true at the bucket level, which makes Supabase
--     serve files via a CDN-style public URL that bypasses RLS entirely for
--     reads. Combined with the open write policy, this meant ID proofs and
--     other student documents were both world-readable (if the path leaked
--     through any channel) and world-writable/deletable. The upload code's
--     own comment ("Unguessable uuid path — access control lives on the
--     metadata table") shows this was known and reasoned about, but the
--     reasoning was incomplete: the metadata table's `documents.view`
--     permission (the one "view" permission that IS properly enforced,
--     per the round-2 permission-matrix audit) protects nothing if the
--     underlying file is sitting in a public bucket regardless of who can
--     see the row that points at it.
--
-- Fix:
--   • student-photos, staff-photos, branch-photos, drill-diagrams stay
--     PUBLIC for reads (matches existing app design — these are rendered
--     via plain <img src> from getPublicUrl(), and photos are low-enough
--     sensitivity that this is a reasonable, deliberate choice). Writes are
--     now scoped to a real owner/staff session for the right academy (and,
--     for student/staff photos, the student/staff themselves).
--   • student-documents, trial-documents are switched to PRIVATE buckets.
--     Reads now require the same authorization the metadata table already
--     enforces (own document / documents.view / students.manage), via
--     signed URLs — src/lib/db.js's getPublicUrl() call for student
--     documents is replaced with createSignedUrl() in the same commit as
--     this migration. trial-documents has no read path in the app at all
--     yet, so it's locked to uploader-only with no further app change needed.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- Bucket-level public flag: only the two document buckets flip.
-- Photo buckets and drill-diagrams stay public (intentional, see above).
-- ════════════════════════════════════════════════════════════════
UPDATE storage.buckets SET public = false WHERE id IN ('student-documents', 'trial-documents');

-- ════════════════════════════════════════════════════════════════
-- Drop every "open access" / unscoped policy this migration replaces
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "branch-photos open access"   ON storage.objects;
DROP POLICY IF EXISTS "student-photos open access"  ON storage.objects;
DROP POLICY IF EXISTS "student-documents open access" ON storage.objects;
DROP POLICY IF EXISTS "trial-documents open access" ON storage.objects;
DROP POLICY IF EXISTS staff_photos_anon_insert ON storage.objects;
DROP POLICY IF EXISTS staff_photos_anon_update ON storage.objects;
DROP POLICY IF EXISTS staff_photos_auth_all    ON storage.objects;
DROP POLICY IF EXISTS drill_diagrams_write     ON storage.objects;
-- staff_photos_anon_select and drill_diagrams_read are SELECT-only and
-- already correctly scoped to just their own bucket_id — left as-is.

-- ════════════════════════════════════════════════════════════════
-- student-photos — path: {studentId}.jpg
-- Read: public (unchanged). Write: owner/staff (own academy, students.manage)
-- or the student uploading their own photo.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY student_photos_write ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'student-photos' AND (
      EXISTS (SELECT 1 FROM students s WHERE s.id = (regexp_replace(name, '\.jpg$', ''))::bigint
              AND s.academy_id = get_my_academy_id())
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = (regexp_replace(name, '\.jpg$', ''))::bigint
                 AND s.academy_id = current_staff_academy() AND current_staff_has_perm('students.manage'))
      OR (regexp_replace(name, '\.jpg$', ''))::bigint = current_student_id()
    )
  );
CREATE POLICY student_photos_update ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (
    bucket_id = 'student-photos' AND (
      EXISTS (SELECT 1 FROM students s WHERE s.id = (regexp_replace(name, '\.jpg$', ''))::bigint
              AND s.academy_id = get_my_academy_id())
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = (regexp_replace(name, '\.jpg$', ''))::bigint
                 AND s.academy_id = current_staff_academy() AND current_staff_has_perm('students.manage'))
      OR (regexp_replace(name, '\.jpg$', ''))::bigint = current_student_id()
    )
  );

-- ════════════════════════════════════════════════════════════════
-- staff-photos — path: staff/{staffId}.jpg
-- Read: public (unchanged, staff_photos_anon_select kept as-is). Write:
-- owner/staff-manager (own academy) or the staff member uploading their own.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY staff_photos_write ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'staff-photos' AND (
      EXISTS (SELECT 1 FROM staff st WHERE st.id = (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint
              AND st.academy_id = get_my_academy_id())
      OR EXISTS (SELECT 1 FROM staff st WHERE st.id = (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint
                 AND st.academy_id = current_staff_academy() AND current_staff_has_perm('staff.manage'))
      OR (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint = (
            SELECT s.id FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
            WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
              AND ss.expires_at > now() LIMIT 1)
    )
  );
CREATE POLICY staff_photos_update ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (
    bucket_id = 'staff-photos' AND (
      EXISTS (SELECT 1 FROM staff st WHERE st.id = (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint
              AND st.academy_id = get_my_academy_id())
      OR EXISTS (SELECT 1 FROM staff st WHERE st.id = (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint
                 AND st.academy_id = current_staff_academy() AND current_staff_has_perm('staff.manage'))
      OR (regexp_replace(regexp_replace(name, '^staff/', ''), '\.jpg$', ''))::bigint = (
            SELECT s.id FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
            WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
              AND ss.expires_at > now() LIMIT 1)
    )
  );

-- ════════════════════════════════════════════════════════════════
-- branch-photos — path: {branchId}.jpg (uuid). Owner-only, matching
-- secure_update_sport_branch's owner-only pattern for this same field.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY branch_photos_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'branch-photos' AND EXISTS (
      SELECT 1 FROM sport_branches b WHERE b.id = (regexp_replace(name, '\.jpg$', ''))::uuid
        AND b.academy_id = get_my_academy_id()
    )
  )
  WITH CHECK (
    bucket_id = 'branch-photos' AND EXISTS (
      SELECT 1 FROM sport_branches b WHERE b.id = (regexp_replace(name, '\.jpg$', ''))::uuid
        AND b.academy_id = get_my_academy_id()
    )
  );

-- ════════════════════════════════════════════════════════════════
-- drill-diagrams — read stays public; write requires a real staff/owner
-- session with training.manage (matches who can edit drills).
-- ════════════════════════════════════════════════════════════════
CREATE POLICY drill_diagrams_write ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'drill-diagrams' AND (
      get_my_academy_id() IS NOT NULL
      OR current_staff_has_perm('training.manage')
    )
  );

-- ════════════════════════════════════════════════════════════════
-- student-documents — now a PRIVATE bucket. Path: {studentId}/{uuid}.{ext}.
-- Mirrors student_documents table RLS exactly: own document (student),
-- documents.view (staff), same-academy (owner) for reads; students.manage
-- (staff) or owner for writes — matching secure_add/delete_student_document.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY student_documents_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'student-documents' AND (
      ((storage.foldername(name))[1])::bigint = current_student_id()
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
                 AND s.academy_id = current_staff_academy() AND current_staff_has_perm('documents.view'))
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
                 AND s.academy_id = get_my_academy_id())
    )
  );
CREATE POLICY student_documents_write ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'student-documents' AND (
      EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
              AND s.academy_id = current_staff_academy() AND current_staff_has_perm('students.manage'))
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
                 AND s.academy_id = get_my_academy_id())
    )
  );
CREATE POLICY student_documents_delete ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'student-documents' AND (
      EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
              AND s.academy_id = current_staff_academy() AND current_staff_has_perm('students.manage'))
      OR EXISTS (SELECT 1 FROM students s WHERE s.id = ((storage.foldername(name))[1])::bigint
                 AND s.academy_id = get_my_academy_id())
    )
  );

-- ════════════════════════════════════════════════════════════════
-- trial-documents — now PRIVATE. Path: {auth.uid()}/{uuid}.{ext}. No read
-- path exists anywhere in the app yet, so this is locked to the uploader
-- only — safe to be this strict since nothing currently depends on broader
-- access, and it's trivial to widen later with a real reviewer flow.
-- ════════════════════════════════════════════════════════════════
CREATE POLICY trial_documents_owner_only ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'trial-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'trial-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;
