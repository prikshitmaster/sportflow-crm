-- 0009: Activity sessions — per-session tracking for /ops/live dashboard
--
-- Tracks who opens the app, how long they stay, and from what device.
-- Populated by AppContext via startActivitySession / heartbeat / endActivitySession.
-- No PII beyond what's already in other tables.

CREATE TABLE IF NOT EXISTS activity_sessions (
  id               BIGSERIAL    PRIMARY KEY,
  session_uuid     UUID         DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  user_id          TEXT,
  user_type        TEXT         NOT NULL,   -- 'student' | 'staff' | 'owner'
  user_name        TEXT         NOT NULL,
  academy_id       UUID,
  academy_name     TEXT,
  started_at       TIMESTAMPTZ  DEFAULT now() NOT NULL,
  last_active_at   TIMESTAMPTZ  DEFAULT now() NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,                 -- filled on graceful close
  device           TEXT                     -- e.g. 'Mobile · Chrome'
);

ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops_open" ON activity_sessions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_act_sess_last_active ON activity_sessions (last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_sess_started     ON activity_sessions (started_at     DESC);
