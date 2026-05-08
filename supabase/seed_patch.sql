-- ============================================================
-- SportFlow CRM — Seed Patch
-- Run AFTER schema.sql → schema_v2.sql → schema_v3.sql
-- Adds: batch schedules, today attendance, events table, leave requests
-- ============================================================

-- ── 1. Batch schedule (days + times for staff schedule view) ──
UPDATE batches SET
  days       = ARRAY['Monday','Wednesday','Friday'],
  start_time = '6:00 AM',
  end_time   = '7:30 AM'
WHERE name = 'Morning A';

UPDATE batches SET
  days       = ARRAY['Tuesday','Thursday','Saturday'],
  start_time = '7:30 AM',
  end_time   = '9:00 AM'
WHERE name = 'Morning B';

UPDATE batches SET
  days       = ARRAY['Monday','Wednesday','Friday'],
  start_time = '4:00 PM',
  end_time   = '5:30 PM'
WHERE name = 'Evening A';

UPDATE batches SET
  days       = ARRAY['Tuesday','Thursday','Saturday'],
  start_time = '5:30 PM',
  end_time   = '7:00 PM'
WHERE name = 'Evening B';

UPDATE batches SET
  days       = ARRAY['Saturday','Sunday'],
  start_time = '8:00 AM',
  end_time   = '10:00 AM'
WHERE name = 'Weekend';

-- ── 2. TODAY'S attendance — run on pitch day for live dashboard ──
-- Present students
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE, id, true, 'Present'
FROM students
WHERE status = 'Active' AND id IN (1,3,5,6,8,10,11,12,14,16,17,18,19,20,21,22)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

-- Absent students
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE, id, false, 'Absent'
FROM students
WHERE status = 'Active' AND id IN (2,4,7,13)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- ── 3. Events table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  date        DATE NOT NULL,
  sport       TEXT,
  type        TEXT DEFAULT 'Event',
  status      TEXT DEFAULT 'Upcoming'
    CHECK (status IN ('Upcoming','Ongoing','Completed','Cancelled')),
  venue       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE events DISABLE ROW LEVEL SECURITY;

INSERT INTO events (title, description, date, sport, type, status, venue) VALUES
('Inter-Academy Football Tournament',
 'Annual tournament with 8 academies. 12 students selected from Morning A batch.',
 '2026-05-18', 'Football', 'Tournament', 'Upcoming', 'DY Patil Stadium'),

('State Martial Arts Championship',
 'State-level competition. Kavya Reddy defending her gold medal.',
 '2026-06-05', 'Martial Arts', 'Championship', 'Upcoming', 'Sports Complex, Pune'),

('Summer Dance Showcase',
 'Year-end performance by Evening A dance students. Parents invited.',
 '2026-05-30', 'Dance', 'Showcase', 'Upcoming', 'Academy Auditorium'),

('Badminton Open — Internal',
 'Internal tournament for Weekend batch. Prizes for top 3.',
 '2026-05-25', 'Badminton', 'Tournament', 'Upcoming', 'Academy Court'),

('Cricket Coaching Camp',
 'Intensive 3-day coaching by ex-Ranji player. Morning B batch only.',
 '2026-05-22', 'Cricket', 'Camp', 'Upcoming', 'Main Ground');

-- ── 4. Sample leave requests ────────────────────────────────
INSERT INTO leave_requests (staff_name, start_date, end_date, reason, status) VALUES
('Pradeep Kumar', '2026-05-10', '2026-05-12', 'Family function — sister''s wedding', 'Pending'),
('Anita Singh',   '2026-04-28', '2026-04-28', 'Medical appointment',                'Approved'),
('Ravi Shankar',  '2026-04-15', '2026-04-15', 'Personal work',                      'Rejected');

-- ── 5. Back-fill fee_amount on students (used in reports) ──
UPDATE students SET fee_amount = fees WHERE fee_amount = 0 OR fee_amount IS NULL;
