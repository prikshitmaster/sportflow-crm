-- 0061: Backfill parents table from legacy students.parent + students.parent_phone
-- WHY: Migration 0057 added parents + parent_students tables, but historical
--      students never got upserted. This one-time backfill makes every
--      existing student linkable from the parent portal without re-saving.
-- IDEMPOTENT — safe to re-run. ON CONFLICT clauses handle duplicates.
--
-- Phone normalization: strips non-digits, takes last 10 chars. Skips students
-- whose normalized phone is shorter than 10 digits (incomplete data).
-- Siblings sharing a parent phone get linked to the same parents row via the
-- (academy_id, phone) uniq index from 0057.

DO $$
DECLARE
  s            RECORD;
  v_parent_id  UUID;
  v_phone      TEXT;
  v_linked     INT := 0;
  v_skipped    INT := 0;
BEGIN
  FOR s IN
    SELECT id, academy_id, parent, parent_phone
    FROM students
    WHERE COALESCE(parent, '')       <> ''
      AND COALESCE(parent_phone, '') <> ''
      AND parent_id IS NULL
  LOOP
    v_phone := right(regexp_replace(s.parent_phone, '\D', '', 'g'), 10);
    IF length(v_phone) < 10 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO parents (academy_id, name, phone)
    VALUES (s.academy_id, s.parent, v_phone)
    ON CONFLICT (academy_id, phone) DO UPDATE
      SET updated_at = NOW()    -- noop touch so RETURNING fires
    RETURNING id INTO v_parent_id;

    INSERT INTO parent_students (parent_id, student_id, relationship, is_primary)
    VALUES (v_parent_id, s.id, 'guardian', TRUE)
    ON CONFLICT (parent_id, student_id) DO NOTHING;

    UPDATE students SET parent_id = v_parent_id WHERE id = s.id;
    v_linked := v_linked + 1;
  END LOOP;

  RAISE NOTICE 'parent backfill: linked=% skipped=%', v_linked, v_skipped;
END $$;
