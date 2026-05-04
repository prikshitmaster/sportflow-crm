-- ============================================================
-- SportFlow CRM — v2 Demo / Test Data
-- Run AFTER schema_v2.sql
-- ============================================================
--
-- ┌─────────────────────────────────────────────────────────┐
-- │  TEST CREDENTIALS (for student login)                   │
-- │                                                         │
-- │  Pre-activated students (login with ID + password):     │
-- │  ─────────────────────────────────────────────────────  │
-- │  SA001  Arjun Sharma     Password: Student@123          │
-- │  SA003  Rahul Verma      Password: Student@123          │
-- │  SA005  Dev Malhotra     Password: Student@123          │
-- │  SA007  Aditya Singh     Password: Student@123          │
-- │  SA010  Ananya Mehta     Password: Student@123          │
-- │                                                         │
-- │  Pending activation (use these on /activate page):      │
-- │  ─────────────────────────────────────────────────────  │
-- │  SA002  Join Code: KR7Q4M                               │
-- │  SA004  Join Code: MX8NP2                               │
-- │  SA006  Join Code: PJ3V6W                               │
-- │  SA008  Join Code: HN4ZB8                               │
-- │  SA009  Join Code: CW5KY9                               │
-- │                                                         │
-- │  Gate QR Token (for attendance scan testing):           │
-- │  ─────────────────────────────────────────────────────  │
-- │  a7f3c9d2e8b5f1a4c6d8e2f7b3a9c5d1                      │
-- │  (use this value as the QR content in StudentScan)      │
-- └─────────────────────────────────────────────────────────┘

-- ============================================================
-- 1. PRE-ACTIVATE STUDENTS WITH PASSWORD  "Student@123"
--    Hash = sha256('sportflow-2026Student@123')
-- ============================================================

UPDATE students
SET
  password_hash  = encode(sha256(('sportflow-2026Student@123')::bytea), 'hex'),
  account_status = 'active',
  join_code      = NULL
WHERE student_code IN ('SA001','SA003','SA005','SA007','SA010');

-- ============================================================
-- 2. SET JOIN CODES FOR PENDING STUDENTS
-- ============================================================

UPDATE students SET join_code = 'KR7Q4M', account_status = 'pending' WHERE student_code = 'SA002';
UPDATE students SET join_code = 'MX8NP2', account_status = 'pending' WHERE student_code = 'SA004';
UPDATE students SET join_code = 'PJ3V6W', account_status = 'pending' WHERE student_code = 'SA006';
UPDATE students SET join_code = 'HN4ZB8', account_status = 'pending' WHERE student_code = 'SA008';
UPDATE students SET join_code = 'CW5KY9', account_status = 'pending' WHERE student_code = 'SA009';
UPDATE students SET join_code = 'BT2LR7', account_status = 'pending' WHERE student_code = 'SA011';
UPDATE students SET join_code = 'DV3MS8', account_status = 'pending' WHERE student_code = 'SA012';
UPDATE students SET join_code = 'FX4NT9', account_status = 'pending' WHERE student_code = 'SA013';
UPDATE students SET join_code = 'GY5PU2', account_status = 'pending' WHERE student_code = 'SA014';
UPDATE students SET join_code = 'HZ6QV3', account_status = 'pending' WHERE student_code = 'SA015';
UPDATE students SET join_code = 'JA7RW4', account_status = 'pending' WHERE student_code = 'SA016';
UPDATE students SET join_code = 'KB8SX5', account_status = 'pending' WHERE student_code = 'SA017';
UPDATE students SET join_code = 'LC9TY6', account_status = 'pending' WHERE student_code = 'SA018';
UPDATE students SET join_code = 'MD2UZ7', account_status = 'pending' WHERE student_code = 'SA019';
UPDATE students SET join_code = 'NE3VA8', account_status = 'pending' WHERE student_code = 'SA020';
UPDATE students SET join_code = 'PF4WB9', account_status = 'pending' WHERE student_code = 'SA021';
UPDATE students SET join_code = 'QG5XC2', account_status = 'pending' WHERE student_code = 'SA022';

-- ============================================================
-- 3. LINK batch_id FOR ALL STUDENTS (batch name → batch FK)
-- ============================================================

UPDATE students s
SET batch_id = b.id
FROM batches b
WHERE s.batch = b.name
  AND s.batch_id IS NULL;

-- ============================================================
-- 4. UPDATE BATCHES WITH DAYS + TIME RANGE
-- ============================================================

UPDATE batches SET
  days       = ARRAY['Mon','Wed','Fri'],
  start_time = '06:00',
  end_time   = '07:30',
  age_min    = 10,
  age_max    = 18
WHERE name = 'Morning A';

UPDATE batches SET
  days       = ARRAY['Tue','Thu','Sat'],
  start_time = '07:30',
  end_time   = '09:00',
  age_min    = 10,
  age_max    = 18
WHERE name = 'Morning B';

UPDATE batches SET
  days       = ARRAY['Mon','Tue','Wed','Thu','Fri'],
  start_time = '16:00',
  end_time   = '17:30',
  age_min    = 8,
  age_max    = 16
WHERE name = 'Evening A';

UPDATE batches SET
  days       = ARRAY['Mon','Tue','Wed','Thu','Fri'],
  start_time = '17:30',
  end_time   = '19:00',
  age_min    = 12,
  age_max    = 20
WHERE name = 'Evening B';

UPDATE batches SET
  days       = ARRAY['Sat','Sun'],
  start_time = '08:00',
  end_time   = '10:00',
  age_min    = 10,
  age_max    = 18
WHERE name = 'Weekend';

-- ============================================================
-- 5. CREATE DEMO GATE QR TOKEN
-- ============================================================

INSERT INTO gate_qr (token, academy_name)
VALUES ('a7f3c9d2e8b5f1a4c6d8e2f7b3a9c5d1', 'Champions Sports Academy')
ON CONFLICT (token) DO NOTHING;

-- ============================================================
-- 6. ADD MORE ATTENDANCE FOR ACTIVE STUDENTS (current month)
--    so the student dashboard shows real calendar data
-- ============================================================

INSERT INTO attendance (date, student_id, present, status)
SELECT
  d.day::date,
  s.id,
  true,
  'Present'
FROM
  (VALUES
    ('2026-05-02'), ('2026-05-05'), ('2026-05-06'), ('2026-05-07'),
    ('2026-05-08'), ('2026-05-09'), ('2026-05-12'), ('2026-05-13'),
    ('2026-05-14'), ('2026-05-16'), ('2026-05-19'), ('2026-05-20'),
    ('2026-05-21'), ('2026-05-22'), ('2026-05-23'), ('2026-05-26'),
    ('2026-05-27'), ('2026-05-28'), ('2026-05-29'), ('2026-05-30')
  ) AS d(day),
  students s
WHERE s.student_code IN ('SA001','SA003','SA005')
ON CONFLICT (date, student_id) DO NOTHING;

-- Add some absences
INSERT INTO attendance (date, student_id, present, status)
SELECT
  d.day::date,
  s.id,
  false,
  'Absent'
FROM
  (VALUES ('2026-05-03'), ('2026-05-10'), ('2026-05-15')) AS d(day),
  students s
WHERE s.student_code IN ('SA001','SA003','SA005')
ON CONFLICT (date, student_id) DO NOTHING;

-- SA007 has more absences (for contrast)
INSERT INTO attendance (date, student_id, present, status)
SELECT
  d.day::date,
  s.id,
  true,
  'Present'
FROM
  (VALUES ('2026-05-05'), ('2026-05-06'), ('2026-05-07'), ('2026-05-08'),
          ('2026-05-12'), ('2026-05-13'), ('2026-05-19'), ('2026-05-20')
  ) AS d(day),
  students s
WHERE s.student_code = 'SA007'
ON CONFLICT (date, student_id) DO NOTHING;

-- ============================================================
-- 7. ADD MONTHLY FEE RECORDS FOR ACTIVE STUDENTS
-- ============================================================

-- Arjun (SA001) - May paid
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA001-05', id, name, fees, 'May 2026', '2026-05-02', 'Paid', 'UPI'
FROM students WHERE student_code = 'SA001'
ON CONFLICT (id) DO NOTHING;

-- Rahul (SA003) - May pending
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA003-05', id, name, fees, 'May 2026', NULL, 'Pending', NULL
FROM students WHERE student_code = 'SA003'
ON CONFLICT (id) DO NOTHING;

-- Dev (SA005) - April overdue
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA005-04', id, name, fees, 'April 2026', NULL, 'Overdue', NULL
FROM students WHERE student_code = 'SA005'
ON CONFLICT (id) DO NOTHING;

-- Dev (SA005) - May pending
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA005-05', id, name, fees, 'May 2026', NULL, 'Pending', NULL
FROM students WHERE student_code = 'SA005'
ON CONFLICT (id) DO NOTHING;

-- Aditya (SA007) - May paid
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA007-05', id, name, fees, 'May 2026', '2026-05-03', 'Paid', 'Cash'
FROM students WHERE student_code = 'SA007'
ON CONFLICT (id) DO NOTHING;

-- Ananya (SA010) - May paid
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode)
SELECT 'INV-2026-SA010-05', id, name, fees, 'May 2026', '2026-05-04', 'Paid', 'UPI'
FROM students WHERE student_code = 'SA010'
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- DONE — Verify with:
-- SELECT student_code, name, account_status, join_code FROM students ORDER BY id;
-- SELECT * FROM gate_qr;
-- ============================================================
