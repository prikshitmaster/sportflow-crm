-- ============================================================
-- 0103 — Student Document Vault
-- ============================================================
-- WHAT
--   • students.crs_number — federation registration number (e.g. AIFF CRS)
--   • student_documents table — birth certificate, ID proof, medical, other
--   • storage bucket 'student-documents' (public read like student-photos:
--     files live at unguessable uuid paths; the REAL access control is on
--     the metadata table below — you can't download what you can't list)
--   • RLS:
--       student → own documents only
--       staff   → academy documents ONLY with 'documents.view' permission
--                 (granted per-coach by owner/manager in Staff page)
--       owner   → all documents in own academy
--   • Writes go through SECURITY DEFINER RPCs (0053 pattern):
--       secure_add_student_document / secure_delete_student_document
--   • secure_update_student_self_profile extended to accept crsNumber
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. students.crs_number ───────────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS crs_number TEXT;

-- ── 2. student_documents table ───────────────────────────────
CREATE TABLE IF NOT EXISTS student_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id  UUID   NOT NULL,
  student_id  BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type    TEXT   NOT NULL DEFAULT 'other'
                CHECK (doc_type IN ('birth_certificate','id_proof','medical','photo_id','other')),
  title       TEXT   NOT NULL,
  file_path   TEXT   NOT NULL,
  file_name   TEXT,
  mime_type   TEXT,
  size_bytes  BIGINT,
  uploaded_by TEXT,                      -- 'student' | 'staff' | 'owner'
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_documents_student_idx ON student_documents (student_id);
CREATE INDEX IF NOT EXISTS student_documents_academy_idx ON student_documents (academy_id);

ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;

-- ── 3. Helper: does the current staff session hold a permission? ──
CREATE OR REPLACE FUNCTION current_staff_has_perm(p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM staff_sessions ss
      JOIN staff s        ON s.id = ss.staff_id
      LEFT JOIN staff_auth sa ON sa.staff_id = s.id
     WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
       AND ss.expires_at > now()
       AND COALESCE(sa.permissions, '[]'::jsonb) ? p_perm
  )
$$;

-- ── 4. RLS policies ──────────────────────────────────────────
-- Student reads own docs; staff read academy docs only with documents.view
DROP POLICY IF EXISTS student_documents_anon_read ON public.student_documents;
CREATE POLICY student_documents_anon_read ON public.student_documents FOR SELECT TO anon
  USING (
    student_id = current_student_id()
    OR (academy_id = current_staff_academy() AND current_staff_has_perm('documents.view'))
  );

-- Owner (Supabase Auth) — full access within own academy
DROP POLICY IF EXISTS student_documents_auth_all ON public.student_documents;
CREATE POLICY student_documents_auth_all ON public.student_documents FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- No anon INSERT/UPDATE/DELETE policies — all writes via the RPCs below.

-- ── 5. RPC: add a document (metadata row) ────────────────────
CREATE OR REPLACE FUNCTION secure_add_student_document(
  p_student_id BIGINT,
  p_doc_type   TEXT,
  p_title      TEXT,
  p_file_path  TEXT,
  p_file_name  TEXT   DEFAULT NULL,
  p_mime_type  TEXT   DEFAULT NULL,
  p_size_bytes BIGINT DEFAULT NULL,
  p_token      TEXT   DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a      RECORD;
  v_acad UUID;
  v_row  student_documents%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT academy_id INTO v_acad FROM students WHERE id = p_student_id;
  IF v_acad IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: own documents only' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'staff' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    IF a.academy_id IS DISTINCT FROM v_acad THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'owner' THEN
    IF a.academy_id IS DISTINCT FROM v_acad THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO student_documents
    (academy_id, student_id, doc_type, title, file_path, file_name, mime_type, size_bytes, uploaded_by)
  VALUES
    (v_acad, p_student_id, COALESCE(NULLIF(p_doc_type, ''), 'other'),
     COALESCE(NULLIF(p_title, ''), COALESCE(p_file_name, 'Document')),
     p_file_path, p_file_name, p_mime_type, p_size_bytes, a.actor_kind)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_add_student_document(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO anon, authenticated;

-- ── 6. RPC: delete a document (returns file_path for storage cleanup) ──
CREATE OR REPLACE FUNCTION secure_delete_student_document(
  p_doc_id UUID,
  p_token  TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a      RECORD;
  v_doc  student_documents%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT * INTO v_doc FROM student_documents WHERE id = p_doc_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM v_doc.student_id THEN
      RAISE EXCEPTION 'forbidden: own documents only' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'staff' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    IF a.academy_id IS DISTINCT FROM v_doc.academy_id THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'owner' THEN
    IF a.academy_id IS DISTINCT FROM v_doc.academy_id THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM student_documents WHERE id = p_doc_id;
  RETURN v_doc.file_path;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_student_document(UUID, TEXT) TO anon, authenticated;

-- ── 7. Extend student self-profile RPC with crs_number ──────
CREATE OR REPLACE FUNCTION secure_update_student_self_profile(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row students%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden: students only' USING ERRCODE = '42501';
  END IF;
  IF a.actor_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'forbidden: can only edit own profile' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    height_cm      = CASE WHEN p_payload ? 'heightCm'      THEN NULLIF(p_payload->>'heightCm','')::INT  ELSE height_cm      END,
    weight_kg      = CASE WHEN p_payload ? 'weightKg'      THEN NULLIF(p_payload->>'weightKg','')::INT  ELSE weight_kg      END,
    preferred_foot = CASE WHEN p_payload ? 'preferredFoot' THEN NULLIF(p_payload->>'preferredFoot','')  ELSE preferred_foot END,
    wing           = CASE WHEN p_payload ? 'wing'          THEN NULLIF(p_payload->>'wing','')           ELSE wing           END,
    crs_number     = CASE WHEN p_payload ? 'crsNumber'     THEN NULLIF(p_payload->>'crsNumber','')      ELSE crs_number     END
  WHERE id = p_student_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student_self_profile(BIGINT, JSONB, TEXT) TO anon, authenticated;

-- ── 8. Storage bucket (same pattern as student-photos) ──────
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-documents', 'student-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'student-documents open access'
  ) THEN
    CREATE POLICY "student-documents open access"
      ON storage.objects
      FOR ALL
      USING (bucket_id = 'student-documents')
      WITH CHECK (bucket_id = 'student-documents');
  END IF;
END $$;

COMMIT;
