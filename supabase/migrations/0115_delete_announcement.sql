-- 0115: secure_delete_announcement
--
-- Community had no delete path at all — posts were permanent once made, and a
-- typo'd or wrong-audience announcement could only be cleaned up from the SQL
-- editor. Follows the 0033 pattern: SECURITY DEFINER, _require_perm, and an
-- explicit same-academy check so a leaked token can't delete another tenant's
-- posts.
--
-- Gated on community.manage — the same key that gates the Community UI. Owners
-- bypass via _require_perm. Sent notifications are deliberately left alone:
-- they are a record of what was delivered, not children of the announcement.

CREATE OR REPLACE FUNCTION secure_delete_announcement(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          RECORD;
  v_academy  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'community.manage');

  SELECT academy_id INTO v_academy FROM announcements WHERE id = p_id;
  IF v_academy IS NULL THEN
    RAISE EXCEPTION 'announcement not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;

  DELETE FROM announcements WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_announcement(BIGINT, TEXT) TO anon, authenticated;
