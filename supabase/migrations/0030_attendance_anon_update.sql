-- 0030: Allow anon role to UPDATE attendance rows
-- Needed because coaches upsert attendance (INSERT ... ON CONFLICT DO UPDATE).
-- When the row already exists the DB issues an UPDATE, which the existing
-- attendance_anon_insert policy does not cover.

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_anon_update" ON attendance;
CREATE POLICY "attendance_anon_update"
  ON attendance FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
