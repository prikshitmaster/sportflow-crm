-- 0008: Player development — session feedback + monthly goals
--
-- Two tables that power the coach-student development loop:
--   1. session_feedback — per-session per-student data
--      - Pulse fields (effort/execution/focus) filled for everyone, takes ~5 min/batch
--      - Spotlight fields (4-corner + note) filled only when coach singles out a player
--      - Self-reflection fields filled by the student from their portal
--   2. player_goals — one focus goal per student per month, set by coach
--
-- Conventions matched from schema_performance.sql:
--   student_id, batch_id, staff_id = BIGINT
--   academy_id                     = UUID

-- ── 1. session_feedback ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_feedback (
  id          BIGSERIAL PRIMARY KEY,
  academy_id  UUID,
  batch_id    BIGINT,
  student_id  BIGINT NOT NULL,
  staff_id    BIGINT,                  -- coach who entered the pulse
  date        DATE   NOT NULL DEFAULT CURRENT_DATE,

  -- Pulse (tier 1) — entered by coach for whole batch
  effort      SMALLINT CHECK (effort     BETWEEN 1 AND 3),
  execution   SMALLINT CHECK (execution  BETWEEN 1 AND 3),
  focus       SMALLINT CHECK (focus      BETWEEN 1 AND 3),

  -- Spotlight (tier 2) — optional, entered only for standout players
  technical   SMALLINT CHECK (technical  BETWEEN 1 AND 3),
  tactical    SMALLINT CHECK (tactical   BETWEEN 1 AND 3),
  physical    SMALLINT CHECK (physical   BETWEEN 1 AND 3),
  mental      SMALLINT CHECK (mental     BETWEEN 1 AND 3),
  note        TEXT,
  spotlight_at TIMESTAMPTZ,             -- set when spotlight fields are filled

  -- Self-reflection (entered by student from their portal)
  self_energy       SMALLINT CHECK (self_energy      BETWEEN 1 AND 3),
  self_performance  SMALLINT CHECK (self_performance BETWEEN 1 AND 3),
  self_focus        SMALLINT CHECK (self_focus       BETWEEN 1 AND 3),
  self_at           TIMESTAMPTZ,

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- One feedback row per (date, student, batch). NULLS NOT DISTINCT so legacy
-- rows without batch_id still collapse correctly on conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_feedback_date_student_batch
  ON session_feedback (date, student_id, batch_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_session_feedback_student     ON session_feedback (student_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_academy     ON session_feedback (academy_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_batch       ON session_feedback (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_feedback_date        ON session_feedback (date);
CREATE INDEX IF NOT EXISTS idx_session_feedback_spotlight   ON session_feedback (student_id, spotlight_at DESC) WHERE spotlight_at IS NOT NULL;

-- ── 2. player_goals ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_goals (
  id          BIGSERIAL PRIMARY KEY,
  academy_id  UUID,
  student_id  BIGINT NOT NULL,
  staff_id    BIGINT,                  -- coach who set the goal
  month       TEXT   NOT NULL,         -- 'YYYY-MM'
  goal_text   TEXT   NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, month)
);

CREATE INDEX IF NOT EXISTS idx_player_goals_student_month ON player_goals (student_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_player_goals_academy       ON player_goals (academy_id);

-- ── 3. RLS — match the academy-scoping pattern from 0003 ────
-- Owner policies will be added by 0003's loop on next run, but we add open
-- policies here so the app works immediately after this migration.
-- Tighten via 0003's helper or by re-running it (it's idempotent).
ALTER TABLE session_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_goals     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_feedback' AND policyname = 'session_feedback_all') THEN
    CREATE POLICY session_feedback_all ON session_feedback FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'player_goals' AND policyname = 'player_goals_all') THEN
    CREATE POLICY player_goals_all ON player_goals FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 4. updated_at trigger ───────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_feedback_touch ON session_feedback;
CREATE TRIGGER trg_session_feedback_touch BEFORE UPDATE ON session_feedback
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_player_goals_touch ON player_goals;
CREATE TRIGGER trg_player_goals_touch BEFORE UPDATE ON player_goals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
