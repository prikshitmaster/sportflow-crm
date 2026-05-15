-- ── Performance System ────────────────────────────────────
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS skill_assessments (
  id             BIGSERIAL PRIMARY KEY,
  student_id     BIGINT NOT NULL,
  staff_id       BIGINT,
  batch_id       BIGINT,
  sport          TEXT NOT NULL,
  assessed_month TEXT NOT NULL,   -- 'YYYY-MM'
  scores         JSONB NOT NULL DEFAULT '{}',
  notes          TEXT,
  academy_id     UUID,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, assessed_month, sport)
);

CREATE TABLE IF NOT EXISTS student_badges (
  id            BIGSERIAL PRIMARY KEY,
  student_id    BIGINT NOT NULL,
  badge_type    TEXT NOT NULL,
  awarded_month TEXT,
  academy_id    UUID,
  awarded_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, badge_type, awarded_month)
);

ALTER TABLE skill_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_badges    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access ON skill_assessments;
CREATE POLICY open_access ON skill_assessments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS open_access ON student_badges;
CREATE POLICY open_access ON student_badges
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
