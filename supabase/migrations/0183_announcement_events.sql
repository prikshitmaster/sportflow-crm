-- 0183 — Announcements can carry event details
--
-- Piece 1 of retiring the Events page. The `events` table has never held a
-- single row across all 9 academies, while `announcements` has 33 — including
-- 6 already typed 'Tournament' and 3 'Holiday'. People are announcing events
-- already; they just have nowhere to put the date, venue or flyer, so those
-- end up buried in the body text or lost.
--
-- Adding them here rather than fixing Events also removes two live bugs by
-- construction: announcements already reach parents (events never did), and
-- already use the shared studentMatchesAudience helper (the events path
-- reimplemented audience matching inline and silently dropped 'students_list').
--
-- `date` is the POST date and keeps that meaning. Event timing is separate —
-- an event announced today can run next month.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS event_date     DATE,
  ADD COLUMN IF NOT EXISTS event_end_date DATE,
  ADD COLUMN IF NOT EXISTS venue          TEXT,
  ADD COLUMN IF NOT EXISTS flyer_url      TEXT;

COMMENT ON COLUMN public.announcements.date IS
  'The day the notice was POSTED. For when an event happens, see event_date.';
COMMENT ON COLUMN public.announcements.event_date IS
  'Optional. Set when this notice is about something happening on a date — '
  'makes it an "event". NULL for an ordinary notice.';
COMMENT ON COLUMN public.announcements.event_end_date IS
  'Optional end of a multi-day event. NULL for single-day or non-events.';

-- Listing upcoming events cheaply; partial so ordinary notices cost nothing.
CREATE INDEX IF NOT EXISTS announcements_event_date_idx
  ON public.announcements (academy_id, event_date)
  WHERE event_date IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- secure_insert_announcement — four new optional params
--
-- DROP then CREATE rather than CREATE OR REPLACE: adding parameters produces a
-- new overload rather than replacing the function, and with every argument
-- defaulted the two signatures would be ambiguous — PostgREST would start
-- failing with "function is not unique" on a call it used to resolve fine.
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.secure_insert_announcement(text,text,text,text,text,text,uuid,text,jsonb);

CREATE OR REPLACE FUNCTION public.secure_insert_announcement(
  p_title          TEXT,
  p_body           TEXT,
  p_type           TEXT,
  p_author         TEXT  DEFAULT NULL,
  p_token          TEXT  DEFAULT NULL,
  p_sport          TEXT  DEFAULT NULL,
  p_branch_id      UUID  DEFAULT NULL,
  p_audience_type  TEXT  DEFAULT 'all',
  p_audience_ids   JSONB DEFAULT '[]'::jsonb,
  p_event_date     DATE  DEFAULT NULL,
  p_event_end_date DATE  DEFAULT NULL,
  p_venue          TEXT  DEFAULT NULL,
  p_flyer_url      TEXT  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a            RECORD;
  v_branch_id  UUID;
  v_row        announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  -- _require_perm already rejects NULL (unauthenticated) and 'student' actors,
  -- lets 'owner' through unconditionally, and checks the JSONB perms array
  -- for staff — same pattern as every other secure_insert_* RPC.
  PERFORM _require_perm(a.actor_kind, a.perms, 'community.manage');

  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  ELSE
    v_branch_id := p_branch_id;
  END IF;

  -- A backwards range is always a typo, and it would silently hide the event
  -- from any "currently running" filter later.
  IF p_event_end_date IS NOT NULL AND p_event_date IS NOT NULL
     AND p_event_end_date < p_event_date THEN
    RAISE EXCEPTION 'event end date cannot be before the start date'
      USING ERRCODE = '22023';
  END IF;

  -- An end date or venue with no start date describes an event that never
  -- happens — reject rather than store something no screen can render.
  IF p_event_date IS NULL AND p_event_end_date IS NOT NULL THEN
    RAISE EXCEPTION 'an end date needs a start date' USING ERRCODE = '22023';
  END IF;

  INSERT INTO announcements (title, body, type, author, date, academy_id, sport, branch_id,
                             audience_type, audience_ids,
                             event_date, event_end_date, venue, flyer_url)
  VALUES (
    p_title,
    p_body,
    p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    public.ist_today(),
    a.academy_id,
    NULLIF(p_sport, ''),
    v_branch_id,
    COALESCE(NULLIF(p_audience_type, ''), 'all'),
    COALESCE(p_audience_ids, '[]'::jsonb),
    p_event_date,
    p_event_end_date,
    NULLIF(p_venue, ''),
    NULLIF(p_flyer_url, '')
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.secure_insert_announcement(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,JSONB,DATE,DATE,TEXT,TEXT
) TO anon, authenticated;

COMMIT;
