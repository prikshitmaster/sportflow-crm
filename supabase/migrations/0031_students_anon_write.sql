-- 0031: Allow anon role to INSERT and UPDATE students
-- Coaches (anon role) need to create and edit students from the staff portal.
-- INSERT is already covered by the create_student_with_payment RPC (SECURITY DEFINER)
-- but direct table inserts also need to be allowed for any other code paths.
-- UPDATE is needed for: activate account, edit student, suspend, status changes.

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "students_anon_insert" ON students;
CREATE POLICY "students_anon_insert"
  ON students FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "students_anon_update" ON students;
CREATE POLICY "students_anon_update"
  ON students FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
  