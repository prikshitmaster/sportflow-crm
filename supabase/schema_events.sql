-- ============================================================
-- SportFlow CRM — Events & Tournaments Schema
-- Run once in Supabase > SQL Editor (idempotent)
-- ============================================================

-- Add new columns to existing events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_ids  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_url     TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS bracket_type  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS participants  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- RLS on events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_anon_read" ON events;
DROP POLICY IF EXISTS "events_auth_all"  ON events;

-- anon read: staff + student portals fetch events without JWT
CREATE POLICY "events_anon_read"
  ON events FOR SELECT TO anon
  USING (true);

-- authenticated full access: owner dashboard
CREATE POLICY "events_auth_all"
  ON events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ============================================================
-- Tournament matches
-- ============================================================

CREATE TABLE IF NOT EXISTS tournament_matches (
  id           BIGSERIAL PRIMARY KEY,
  event_id     BIGINT  NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round        INTEGER NOT NULL DEFAULT 1,
  match_number INTEGER NOT NULL DEFAULT 1,
  player1_id   BIGINT,
  player1_name TEXT,
  player2_id   BIGINT,
  player2_name TEXT,
  is_bye       BOOLEAN NOT NULL DEFAULT FALSE,
  winner_id    BIGINT,
  winner_name  TEXT,
  score        TEXT,
  played_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournament_matches_event_idx ON tournament_matches(event_id);

ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tournament_matches_all" ON tournament_matches;
CREATE POLICY "tournament_matches_all"
  ON tournament_matches FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
