-- 0010: Trials v2 — pipeline stages, sessions tracking, coach feedback, dynamic sources
--
-- Adds columns to the existing trials table (all IF NOT EXISTS so safe to re-run).
-- Also creates trial_sources table to replace the hardcoded SOURCES array.

-- ── 1. New columns on trials ─────────────────────────────────

ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS stage          TEXT    DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS batch_id       BIGINT,
  ADD COLUMN IF NOT EXISTS age            SMALLINT,
  ADD COLUMN IF NOT EXISTS trial_sessions SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sessions_done  SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coach_note     TEXT,
  ADD COLUMN IF NOT EXISTS coach_rec      TEXT;   -- 'accept' | 'followup' | 'decline' | null

-- Migrate existing status → stage for any rows that have no stage set
UPDATE trials
SET stage = CASE
  WHEN converted = true   THEN 'converted'
  WHEN status = 'Completed' THEN 'attended'
  WHEN status = 'Cancelled' THEN 'rejected'
  ELSE 'scheduled'
END
WHERE stage IS NULL OR stage = 'new';

-- ── 2. trial_sources — replaces hardcoded SOURCES in mockData.js ─────────────

CREATE TABLE IF NOT EXISTS trial_sources (
  id         BIGSERIAL    PRIMARY KEY,
  academy_id UUID         NOT NULL,
  label      TEXT         NOT NULL,
  sort_order INTEGER      DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE trial_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open" ON trial_sources FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_trial_sources_academy ON trial_sources (academy_id);
