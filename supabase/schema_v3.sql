-- SportFlow CRM — Schema v3
-- Run in Supabase > SQL Editor > New Query

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'Tournament',
  sport       TEXT,
  date        DATE NOT NULL,
  end_date    DATE,
  venue       TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'Upcoming'
    CHECK (status IN ('Upcoming','Ongoing','Completed','Cancelled')),
  result      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE events DISABLE ROW LEVEL SECURITY;

-- Seed demo events
INSERT INTO events (title, type, sport, date, end_date, venue, description, status) VALUES
('Inter-Academy Football Tournament', 'Tournament', 'Football', '2026-05-18', '2026-05-18', 'DY Patil Stadium', 'Annual inter-academy tournament. All football students must attend.', 'Upcoming'),
('Badminton District Championship', 'Tournament', 'Badminton', '2026-05-25', '2026-05-26', 'Indoor Sports Complex', 'District level championship. Selected students will participate.', 'Upcoming'),
('Summer Training Camp', 'Training Camp', NULL, '2026-06-01', '2026-06-07', 'Academy Ground', 'Intensive 7-day training camp for all active students.', 'Upcoming'),
('Cricket Practice Match', 'Match', 'Cricket', '2026-05-10', '2026-05-10', 'Cricket Ground', 'Friendly practice match against City Cricket Club.', 'Completed'),
('Parent-Teacher Sports Meet', 'Meeting', NULL, '2026-05-30', NULL, 'Academy Hall', 'Annual sports meet and progress discussion with parents.', 'Upcoming'),
('Buddha Purnima — Academy Closed', 'Holiday', NULL, '2026-05-15', NULL, NULL, 'Academy closed for Buddha Purnima. Regular classes resume May 16.', 'Upcoming')
ON CONFLICT DO NOTHING;
