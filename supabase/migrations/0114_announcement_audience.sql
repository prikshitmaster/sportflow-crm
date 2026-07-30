-- 0114: Explicit audience targeting for announcements.
--
-- Until now an announcement's audience was implicit — whatever sport/branch the
-- sender happened to have selected, broadcast to every staff + active student in
-- that scope. Owners had no way to say "just Batch A" or "only these 3 staff".
--
-- Mirrors the shape events already use (schema_events.sql):
--   audience_type: all | students | staff | batches | staff_members | students_list
--   audience_ids : JSONB array of batch ids / staff ids / student ids
--
-- Branch/sport tagging is UNCHANGED and still applied first — audience narrows
-- within the sender's scope, it never widens across branches.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience_type TEXT  NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS audience_ids  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Replace secure_insert_announcement to accept the audience params.
-- Existing callers that omit them keep working (defaults = academy-wide 'all').
CREATE OR REPLACE FUNCTION secure_insert_announcement(
  p_title         TEXT,
  p_body          TEXT,
  p_type          TEXT,
  p_author        TEXT    DEFAULT NULL,
  p_token         TEXT    DEFAULT NULL,
  p_sport         TEXT    DEFAULT NULL,
  p_branch_id     UUID    DEFAULT NULL,
  p_audience_type TEXT    DEFAULT 'all',
  p_audience_ids  JSONB   DEFAULT '[]'::jsonb
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

  INSERT INTO announcements (title, body, type, author, date, academy_id, sport, branch_id,
                             audience_type, audience_ids)
  VALUES (
    p_title,
    p_body,
    p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    CURRENT_DATE,
    a.academy_id,
    NULLIF(p_sport, ''),
    p_branch_id,
    COALESCE(NULLIF(p_audience_type, ''), 'all'),
    COALESCE(p_audience_ids, '[]'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO anon, authenticated;
-- Keep the older signatures working (PostgreSQL overloads by argument count)
GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
