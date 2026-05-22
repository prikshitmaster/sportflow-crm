-- 0056: Add sport + branch_id to announcements for staff-scope filtering
-- Staff who post announcements are auto-tagged with their sport/branch so
-- other branches/sports don't see cross-scope messages.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS sport      TEXT,
  ADD COLUMN IF NOT EXISTS branch_id  UUID REFERENCES sport_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_sport     ON announcements (sport)      WHERE sport IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_branch_id ON announcements (branch_id)  WHERE branch_id IS NOT NULL;

-- Replace secure_insert_announcement to accept optional sport + branch_id.
-- Existing callers that omit the new params continue to work (NULL = academy-wide).
CREATE OR REPLACE FUNCTION secure_insert_announcement(
  p_title     TEXT,
  p_body      TEXT,
  p_type      TEXT,
  p_author    TEXT    DEFAULT NULL,
  p_token     TEXT    DEFAULT NULL,
  p_sport     TEXT    DEFAULT NULL,
  p_branch_id UUID    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a     RECORD;
  v_row announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO announcements (title, body, type, author, date, academy_id, sport, branch_id)
  VALUES (
    p_title,
    p_body,
    p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    CURRENT_DATE,
    a.academy_id,
    NULLIF(p_sport, ''),
    p_branch_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO anon, authenticated;
-- Keep old 5-arg signature working (PostgreSQL overloads by argument count)
GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
