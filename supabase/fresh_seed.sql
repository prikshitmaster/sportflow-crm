-- ============================================================
-- SportFlow CRM — Fresh Seed Data (May 2026)
-- ============================================================
-- INSTRUCTIONS
--   1. Run all schema files first (schema.sql → schema_v2.sql →
--      schema_v3.sql → schema_permissions.sql → seed_patch.sql)
--   2. Sign up as owner in the app — this creates your academy row
--   3. Run THIS file in Supabase SQL Editor
--
-- ┌─────────────────────────────────────────────────────────┐
-- │  STUDENT LOGIN CREDENTIALS (after running this file)    │
-- │                                                         │
-- │  Activated — login at /student/login                    │
-- │  SA001  Arjun Sharma     Student@123                    │
-- │  SA005  Rahul Verma      Student@123                    │
-- │  SA007  Aditya Singh     Student@123                    │
-- │  SA011  Ananya Mehta     Student@123                    │
-- │  SA016  Priya Patel      Student@123                    │
-- │                                                         │
-- │  Pending activation — go to /activate                   │
-- │  SA002  Dev Malhotra     Join Code: KD2MV8              │
-- │  SA006  Kavya Reddy      Join Code: KV3RX9              │
-- │  SA009  Kabir Ansari     Join Code: KB4SY2              │
-- │  SA014  Nisha Gupta      Join Code: NG5TZ3              │
-- │  SA021  Riya Desai       Join Code: RD6UA4              │
-- │                                                         │
-- │  Gate QR token (test at /gate-qr):                      │
-- │  sf-gate-2026-test-token-abc123xyz                      │
-- └─────────────────────────────────────────────────────────┘
-- ============================================================

-- ── 0. WIPE EXISTING DATA ────────────────────────────────
TRUNCATE TABLE
  attendance, student_sessions, payments, trials,
  students, batches, staff, events, announcements, leave_requests,
  user_permissions, staff_invites, academy_branches, gate_qr
RESTART IDENTITY CASCADE;

DELETE FROM feature_flags;

-- ── 1. STAFF (12 members) ────────────────────────────────
INSERT INTO staff (name, role, phone, sports, salary, join_date, status, attendance) VALUES
('Suresh Yadav',   'Head Coach',     '9823401567', ARRAY['Football','Cricket'],          35000, '2024-06-01', 'Active', 96),
('Pradeep Kumar',  'Coach',          '9845612370', ARRAY['Cricket','Martial Arts'],       28000, '2024-08-15', 'Active', 94),
('Anita Singh',    'Dance Trainer',  '9867234501', ARRAY['Dance'],                        25000, '2024-09-01', 'Active', 98),
('Ravi Shankar',   'Coach',          '9712345670', ARRAY['Football'],                     27000, '2024-07-10', 'Active', 91),
('Monica Nair',    'Coach',          '9934012567', ARRAY['Tennis','Badminton'],           26000, '2024-10-01', 'Active', 97),
('Deepak Jha',     'Admin',          '9823456701', ARRAY[]::text[],                       22000, '2024-06-01', 'Active', 99),
('Vikram Bhatia',  'Coach',          '9856712340', ARRAY['Basketball','Cricket'],         24000, '2024-11-01', 'Active', 92),
('Rekha Verma',    'Trainer',        '9745123456', ARRAY['Badminton'],                    22000, '2025-01-15', 'Active', 95),
('Neha Sharma',    'Receptionist',   '9812345601', ARRAY[]::text[],                       18000, '2025-02-01', 'Active', 100),
('Rajesh Tiwari',  'Support Staff',  '9901234567', ARRAY[]::text[],                       16000, '2025-03-01', 'Active', 88),
('Kavitha Rao',    'Dance Trainer',  '9789012345', ARRAY['Dance','Martial Arts'],         23000, '2024-12-01', 'Active', 96),
('Arjun Pillai',   'Coach',          '9678901234', ARRAY['Martial Arts','Football'],      25000, '2025-01-10', 'Inactive', 82);

-- ── 2. BATCHES (8 batches) ───────────────────────────────
INSERT INTO batches (name, time, sports, coach, capacity, enrolled, waitlist, days, start_time, end_time, ground) VALUES
('Morning Elite',    '5:30 AM – 7:00 AM',       ARRAY['Football','Cricket'],         'Suresh Yadav',  20, 15, 2,
 ARRAY['Monday','Wednesday','Friday'],        '5:30 AM',  '7:00 AM',  'Main Ground'),

('Morning A',        '6:30 AM – 8:00 AM',       ARRAY['Cricket','Martial Arts'],     'Pradeep Kumar', 25, 20, 1,
 ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday'], '6:30 AM', '8:00 AM', 'North Court'),

('Morning B',        '8:00 AM – 9:30 AM',       ARRAY['Badminton','Tennis'],         'Monica Nair',   20, 16, 0,
 ARRAY['Tuesday','Thursday','Saturday'],       '8:00 AM',  '9:30 AM',  'Indoor Hall'),

('Afternoon Junior', '2:00 PM – 3:30 PM',       ARRAY['Dance'],                      'Kavitha Rao',   20, 12, 0,
 ARRAY['Monday','Wednesday','Friday'],        '2:00 PM',  '3:30 PM',  'Studio A'),

('Evening A',        '4:00 PM – 5:30 PM',       ARRAY['Dance','Badminton'],          'Anita Singh',   25, 22, 3,
 ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday'], '4:00 PM', '5:30 PM', 'Indoor Hall'),

('Evening B',        '5:30 PM – 7:00 PM',       ARRAY['Football','Martial Arts'],    'Ravi Shankar',  20, 18, 2,
 ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday'], '5:30 PM', '7:00 PM', 'Main Ground'),

('Evening C',        '7:00 PM – 8:30 PM',       ARRAY['Cricket','Basketball'],       'Vikram Bhatia', 20, 14, 0,
 ARRAY['Monday','Wednesday','Friday'],        '7:00 PM',  '8:30 PM',  'South Court'),

('Weekend Academy',  'Sat–Sun 8:00 AM – 10:00 AM', ARRAY['Tennis','Badminton'],     'Monica Nair',   15, 10, 1,
 ARRAY['Saturday','Sunday'],                  '8:00 AM',  '10:00 AM', 'Indoor Hall');

-- ── 3. STUDENTS (30) ─────────────────────────────────────
-- batch_id: 1=Morning Elite, 2=Morning A, 3=Morning B,
--           4=Afternoon Junior, 5=Evening A, 6=Evening B,
--           7=Evening C, 8=Weekend Academy
INSERT INTO students
  (name, parent, phone, age, sport, batch, batch_id, join_date, status,
   fees, paid_till, student_code, account_status, parent_phone, fee_amount, fee_due_day) VALUES

-- Morning Elite (batch 1) — Football / Cricket
('Arjun Sharma',     'Rajesh Sharma',    '9876543210', 14, 'Football',    'Morning Elite', 1, '2025-01-10', 'Active',   2500, '2026-04-30', 'SA001', 'pending', '9876543210', 2500, 5),
('Dev Malhotra',     'Deepak Malhotra',  '9845612378', 16, 'Football',    'Morning Elite', 1, '2025-01-08', 'Active',   2500, '2026-03-31', 'SA002', 'pending', '9845612378', 2500, 5),
('Varun Khanna',     'Mohit Khanna',     '9745230189', 15, 'Cricket',     'Morning Elite', 1, '2025-03-22', 'Active',   2500, '2026-04-30', 'SA003', 'pending', '9745230189', 2500, 5),
('Karan Kapoor',     'Suniel Kapoor',    '9823045617', 15, 'Football',    'Morning Elite', 1, '2025-01-25', 'Active',   2500, '2026-05-31', 'SA004', 'pending', '9823045617', 2500, 5),

-- Morning A (batch 2) — Cricket / Martial Arts
('Rahul Verma',      'Anil Verma',       '9898765432', 15, 'Cricket',     'Morning A',     2, '2025-01-20', 'Active',   2500, '2026-04-30', 'SA005', 'pending', '9898765432', 2500, 5),
('Kavya Reddy',      'Srinivas Reddy',   '9823456701', 11, 'Martial Arts','Morning A',     2, '2025-02-20', 'Active',   2200, '2026-05-31', 'SA006', 'pending', '9823456701', 2200, 5),
('Aditya Singh',     'Vikram Singh',     '9867542310', 14, 'Cricket',     'Morning A',     2, '2025-03-12', 'Active',   2500, '2026-04-30', 'SA007', 'pending', '9867542310', 2500, 5),
('Tanvi Srivastava', 'Alok Srivastava',  '9912034567', 12, 'Martial Arts','Morning A',     2, '2025-03-30', 'Active',   2200, '2026-04-30', 'SA008', 'pending', '9912034567', 2200, 5),
('Kabir Ansari',     'Aslam Ansari',     '9867890123', 13, 'Cricket',     'Morning A',     2, '2025-04-15', 'Active',   2500, '2026-05-31', 'SA009', 'pending', '9867890123', 2500, 5),

-- Morning B (batch 3) — Badminton / Tennis
('Sneha Iyer',       'Krishnan Iyer',    '9756432109', 13, 'Badminton',   'Morning B',     3, '2025-03-05', 'Active',   1800, '2026-04-30', 'SA010', 'pending', '9756432109', 1800, 5),
('Ananya Mehta',     'Rajiv Mehta',      '9876512340', 13, 'Badminton',   'Morning B',     3, '2025-05-15', 'Active',   1800, '2026-05-31', 'SA011', 'pending', '9876512340', 1800, 5),
('Yash Tiwari',      'Ramesh Tiwari',    '9876034512', 17, 'Tennis',      'Morning B',     3, '2025-01-30', 'Inactive', 3000, '2026-01-31', 'SA012', 'pending', '9876034512', 3000, 5),
('Siya Jain',        'Vinod Jain',       '9812309876', 12, 'Badminton',   'Morning B',     3, '2025-04-01', 'Active',   1800, '2026-04-30', 'SA013', 'pending', '9812309876', 1800, 5),

-- Afternoon Junior (batch 4) — Dance
('Nisha Gupta',      'Manoj Gupta',      '9712345678', 10, 'Dance',       'Afternoon Junior', 4, '2025-04-01', 'Active', 2000, '2026-04-30', 'SA014', 'pending', '9712345678', 2000, 5),
('Shruti Mishra',    'Sunil Mishra',     '9823671450', 10, 'Dance',       'Afternoon Junior', 4, '2025-04-18', 'Active', 2000, '2026-05-31', 'SA015', 'pending', '9823671450', 2000, 5),

-- Evening A (batch 5) — Dance / Badminton
('Priya Patel',      'Suresh Patel',     '9812345678', 12, 'Dance',       'Evening A',     5, '2025-02-15', 'Active',   2000, '2026-04-30', 'SA016', 'pending', '9812345678', 2000, 5),
('Pooja Sharma',     'Rakesh Sharma',    '9912345608', 11, 'Dance',       'Evening A',     5, '2025-02-28', 'Active',   2000, '2026-03-31', 'SA017', 'pending', '9912345608', 2000, 5),
('Meera Pillai',     'Ravi Pillai',      '9756781234', 11, 'Dance',       'Evening A',     5, '2025-04-25', 'Active',   2000, '2026-04-30', 'SA018', 'pending', '9756781234', 2000, 5),
('Isha Kumar',       'Sanjay Kumar',     '9801234567', 10, 'Dance',       'Evening A',     5, '2025-05-01', 'Active',   2000, '2026-05-31', 'SA019', 'pending', '9801234567', 2000, 5),
('Ritika Bansal',    'Pankaj Bansal',    '9834512670', 13, 'Badminton',   'Evening A',     5, '2025-05-01', 'Active',   1800, '2026-04-30', 'SA020', 'pending', '9834512670', 1800, 5),

-- Evening B (batch 6) — Football / Martial Arts
('Riya Desai',       'Hiren Desai',      '9834567012', 12, 'Football',    'Evening B',     6, '2025-03-10', 'Active',   2500, '2026-04-30', 'SA021', 'pending', '9834567012', 2500, 5),
('Dhruv Pandey',     'Ashok Pandey',     '9834120567', 15, 'Football',    'Evening B',     6, '2025-02-22', 'Active',   2500, '2026-05-31', 'SA022', 'pending', '9834120567', 2500, 5),
('Divya Nair',       'Suresh Nair',      '9745621389', 12, 'Martial Arts','Evening B',     6, '2025-03-18', 'Active',   2200, '2026-04-30', 'SA023', 'pending', '9745621389', 2200, 5),
('Aryan Bose',       'Arnab Bose',       '9756781235', 14, 'Martial Arts','Evening B',     6, '2025-04-05', 'Active',   2200, '2026-04-30', 'SA024', 'pending', '9756781235', 2200, 5),
('Rohan Joshi',      'Prakash Joshi',    '9934561278', 17, 'Football',    'Evening B',     6, '2025-02-10', 'Inactive', 2500, '2025-12-31', 'SA025', 'pending', '9934561278', 2500, 5),

-- Evening C (batch 7) — Cricket / Basketball
('Amit Yadav',       'Satish Yadav',     '9845031278', 13, 'Cricket',     'Evening C',     7, '2025-01-12', 'Active',   2500, '2026-05-31', 'SA026', 'pending', '9845031278', 2500, 5),
('Ishaan Chopra',    'Rajan Chopra',     '9867231450', 16, 'Basketball',  'Evening C',     7, '2025-04-10', 'Active',   2000, '2026-04-30', 'SA027', 'pending', '9867231450', 2000, 5),
('Sahil Kapoor',     'Vinay Kapoor',     '9823451267', 15, 'Basketball',  'Evening C',     7, '2025-05-05', 'Active',   2000, '2026-04-30', 'SA028', 'pending', '9823451267', 2000, 5),

-- Weekend Academy (batch 8) — Tennis / Badminton
('Nikhil Agarwal',   'Dinesh Agarwal',   '9867012345', 16, 'Tennis',      'Weekend Academy', 8, '2025-02-05', 'Active', 3000, '2026-05-31', 'SA029', 'pending', '9867012345', 3000, 5),
('Navya Sethi',      'Rahul Sethi',      '9823456012', 11, 'Tennis',      'Weekend Academy', 8, '2025-04-20', 'Active', 3000, '2026-04-30', 'SA030', 'pending', '9823456012', 3000, 5);

-- ── 4. PAYMENTS — May 2026 ───────────────────────────────
-- 12 Paid · 9 Pending · 5 Overdue + 4 historical April paid

-- MAY PAID (12)
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode) VALUES
('INV-2026-001',  4,  'Karan Kapoor',     2500, 'May 2026',   '2026-05-02', 'Paid', 'UPI'),
('INV-2026-002',  6,  'Kavya Reddy',      2200, 'May 2026',   '2026-05-03', 'Paid', 'Cash'),
('INV-2026-003',  9,  'Kabir Ansari',     2500, 'May 2026',   '2026-05-04', 'Paid', 'UPI'),
('INV-2026-004',  11, 'Ananya Mehta',     1800, 'May 2026',   '2026-05-05', 'Paid', 'UPI'),
('INV-2026-005',  15, 'Shruti Mishra',    2000, 'May 2026',   '2026-05-02', 'Paid', 'Bank Transfer'),
('INV-2026-006',  19, 'Isha Kumar',       2000, 'May 2026',   '2026-05-03', 'Paid', 'UPI'),
('INV-2026-007',  22, 'Dhruv Pandey',     2500, 'May 2026',   '2026-05-06', 'Paid', 'UPI'),
('INV-2026-008',  26, 'Amit Yadav',       2500, 'May 2026',   '2026-05-04', 'Paid', 'Cash'),
('INV-2026-009',  29, 'Nikhil Agarwal',   3000, 'May 2026',   '2026-05-01', 'Paid', 'Bank Transfer'),
('INV-2026-010',  3,  'Varun Khanna',     2500, 'May 2026',   '2026-05-07', 'Paid', 'UPI'),
('INV-2026-011',  10, 'Sneha Iyer',       1800, 'May 2026',   '2026-05-06', 'Paid', 'Cash'),
('INV-2026-012',  14, 'Nisha Gupta',      2000, 'May 2026',   '2026-05-05', 'Paid', 'UPI');

-- MAY PENDING (9)
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode) VALUES
('INV-2026-013',  1,  'Arjun Sharma',     2500, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-014',  5,  'Rahul Verma',      2500, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-015',  7,  'Aditya Singh',     2500, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-016',  8,  'Tanvi Srivastava', 2200, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-017',  13, 'Siya Jain',        1800, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-018',  16, 'Priya Patel',      2000, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-019',  18, 'Meera Pillai',     2000, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-020',  21, 'Riya Desai',       2500, 'May 2026',   NULL, 'Pending', NULL),
('INV-2026-021',  30, 'Navya Sethi',      3000, 'May 2026',   NULL, 'Pending', NULL);

-- MAY OVERDUE (5) — students who missed April too
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode) VALUES
('INV-2026-022',  17, 'Pooja Sharma',     2000, 'April 2026', NULL, 'Overdue', NULL),
('INV-2026-023',  20, 'Ritika Bansal',    1800, 'April 2026', NULL, 'Overdue', NULL),
('INV-2026-024',  23, 'Divya Nair',       2200, 'April 2026', NULL, 'Overdue', NULL),
('INV-2026-025',  24, 'Aryan Bose',       2200, 'April 2026', NULL, 'Overdue', NULL),
('INV-2026-026',  2,  'Dev Malhotra',     2500, 'March 2026', NULL, 'Overdue', NULL);

-- HISTORICAL PAID — April 2026 (reference data for reports)
INSERT INTO payments (id, student_id, student, amount, month, date, status, mode) VALUES
('INV-2026-027',  4,  'Karan Kapoor',     2500, 'April 2026', '2026-04-03', 'Paid', 'UPI'),
('INV-2026-028',  9,  'Kabir Ansari',     2500, 'April 2026', '2026-04-05', 'Paid', 'Cash'),
('INV-2026-029',  26, 'Amit Yadav',       2500, 'April 2026', '2026-04-04', 'Paid', 'UPI'),
('INV-2026-030',  29, 'Nikhil Agarwal',   3000, 'April 2026', '2026-04-02', 'Paid', 'Bank Transfer');

-- ── 5. TRIALS (12 leads) ─────────────────────────────────
INSERT INTO trials (name, parent, phone, sport, trial_date, source, status, converted, follow_up) VALUES
('Aarav Kumar',       'Sanjay Kumar',    '9801234560', 'Football',    '2026-05-10', 'Instagram',     'Scheduled', false, '2026-05-15'),
('Zara Khan',         'Imran Khan',      '9834567011', 'Dance',       '2026-05-12', 'Referral',      'Scheduled', false, '2026-05-17'),
('Ronit Sharma',      'Harish Sharma',   '9867890120', 'Cricket',     '2026-05-08', 'Walk-in',       'Scheduled', false, '2026-05-13'),
('Anika Joshi',       'Pratap Joshi',    '9812309870', 'Badminton',   '2026-05-14', 'Google',        'Scheduled', false, '2026-05-19'),
('Veer Malhotra',     'Sudeep Malhotra', '9756781230', 'Martial Arts','2026-05-16', 'Facebook',      'Scheduled', false, '2026-05-21'),
('Tara Nair',         'Suresh Nair',     '9823456010', 'Tennis',      '2026-05-05', 'Word of Mouth', 'Completed', true,  NULL),
('Mihir Patel',       'Chirag Patel',    '9834120560', 'Football',    '2026-05-03', 'Instagram',     'Completed', true,  NULL),
('Sana Qureshi',      'Farhan Qureshi',  '9867234510', 'Dance',       '2026-04-28', 'Referral',      'Completed', false, '2026-05-05'),
('Laksh Verma',       'Rohit Verma',     '9712345671', 'Basketball',  '2026-04-25', 'Google',        'Completed', true,  NULL),
('Ritu Kapoor',       'Sunil Kapoor',    '9901234560', 'Badminton',   '2026-04-20', 'Walk-in',       'Completed', false, '2026-04-27'),
('Harsh Bansal',      'Punit Bansal',    '9845031270', 'Cricket',     '2026-04-15', 'Instagram',     'Cancelled', false, NULL),
('Diya Menon',        'Arvind Menon',    '9789012346', 'Dance',       '2026-04-18', 'Facebook',      'Cancelled', false, NULL);

-- ── 6. TODAY'S ATTENDANCE + RECENT DAYS ─────────────────
-- Today (dynamic — always runs as "today")
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,3,4,5,6,7,8,9,10,11,13,14,15,16,18,19,20,22,23,24,26,27,28,29)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (2,17,21,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- Yesterday
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 1, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,4,5,6,9,11,14,15,16,19,22,26,29)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 1, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (3,7,8,10,13,18,20,23,24,27,28,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- 2 days ago
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 2, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,3,4,5,6,7,8,9,10,11,13,14,15,16,18,19,20,22,23,24,26,27,29,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 2, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (2,17,21,28)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- 3 days ago
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 3, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,4,6,9,11,15,16,19,22,26,29)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 3, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (3,5,7,8,10,13,14,18,20,23,24,27,28,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- 5 days ago
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 5, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,3,4,5,7,9,11,13,14,16,18,19,22,24,26,27,29)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 5, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (2,6,8,10,15,17,20,21,23,28,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- 7 days ago
INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 7, id, true, 'Present'
FROM students WHERE status = 'Active' AND id IN (1,4,5,6,8,9,10,11,14,15,16,19,20,22,23,24,26,29,30)
ON CONFLICT (date, student_id) DO UPDATE SET present = true, status = 'Present';

INSERT INTO attendance (date, student_id, present, status)
SELECT CURRENT_DATE - 7, id, false, 'Absent'
FROM students WHERE status = 'Active' AND id IN (3,7,13,17,18,21,27,28)
ON CONFLICT (date, student_id) DO UPDATE SET present = false, status = 'Absent';

-- ── 7. EVENTS (7 events) ─────────────────────────────────
INSERT INTO events (title, description, date, end_date, sport, type, status, venue) VALUES
('Inter-Academy Football Cup 2026',
 'Annual inter-academy tournament — 10 teams competing. Our students from Morning Elite & Evening B batches are participating.',
 '2026-05-18', '2026-05-19', 'Football', 'Tournament', 'Upcoming',
 'DY Patil Stadium, Navi Mumbai'),

('State Martial Arts Championship',
 'State-level competition. Kavya Reddy defending gold from last year. Aryan Bose competing for the first time.',
 '2026-06-05', '2026-06-06', 'Martial Arts', 'Championship', 'Upcoming',
 'Sports Complex, Pune'),

('Summer Dance Showcase',
 'Year-end performance by Evening A and Afternoon Junior dance students. All parents are invited.',
 '2026-05-30', '2026-05-30', 'Dance', 'Showcase', 'Upcoming',
 'Academy Auditorium'),

('Badminton Open — Internal',
 'Internal tournament for Morning B and Weekend Academy students. Cash prizes for top 3.',
 '2026-05-25', '2026-05-25', 'Badminton', 'Tournament', 'Upcoming',
 'Indoor Hall'),

('Cricket Intensive Camp',
 '2-day coaching camp by former Ranji Trophy player. Morning A and Evening C batch only.',
 '2026-05-22', '2026-05-23', 'Cricket', 'Camp', 'Upcoming',
 'Main Ground'),

('Annual Sports Day 2026',
 'Full-day event with demonstrations from all sports, prize distribution, and parent interaction.',
 '2026-06-15', '2026-06-15', NULL, 'Event', 'Upcoming',
 'Academy Campus'),

('Basketball Friendly — Green vs Blue',
 'Internal friendly match between Evening C students. Great for team building.',
 '2026-05-10', '2026-05-10', 'Basketball', 'Tournament', 'Completed',
 'South Court');

-- ── 8. ANNOUNCEMENTS (6) ─────────────────────────────────
INSERT INTO announcements (title, body, type, author, date) VALUES
('Academy Closed — 15 May (Buddha Purnima)',
 'The academy will remain closed on Wednesday, 15th May for Buddha Purnima. All classes resume from 16th May. Stay safe!',
 'Holiday', 'Admin', CURRENT_DATE - 5),

('May Fees — Last Date 10th May',
 'Monthly fees for May 2026 are due by 10th May. Pay via UPI to 9823401567 or drop cash at reception. Receipts generated instantly.',
 'Reminder', 'Admin', CURRENT_DATE - 3),

('Congratulations! Navya Sethi — District Tennis Champion',
 'Huge congratulations to Navya Sethi (SA030) who won the District Junior Tennis Championship on 5th May. We are incredibly proud!',
 'Achievement', 'Admin', CURRENT_DATE - 1),

('Football Tournament — Squad Announced',
 'The 14-member squad for the Inter-Academy Football Cup has been announced. Please see the notice board. Final practice on May 16.',
 'Tournament', 'Suresh Yadav', CURRENT_DATE - 2),

('New Batch Launching — Swimming (June 1)',
 'We are launching a beginner Swimming batch from June 1st. Timings: 7:00 AM – 8:00 AM, Monday–Friday. Limited to 15 seats. Register at reception by May 25.',
 'Announcement', 'Admin', CURRENT_DATE - 4),

('Emergency Contact Update Request',
 'All parents are requested to verify and update their emergency contact numbers at reception before May 20. This is mandatory for event participation.',
 'Reminder', 'Neha Sharma', CURRENT_DATE - 6);

-- ── 9. LEAVE REQUESTS (5) ────────────────────────────────
INSERT INTO leave_requests (staff_name, start_date, end_date, reason, status) VALUES
('Pradeep Kumar', CURRENT_DATE + 3,  CURRENT_DATE + 5,  'Sister''s wedding — out of town',        'Pending'),
('Ravi Shankar',  CURRENT_DATE + 1,  CURRENT_DATE + 1,  'Medical checkup — doctor appointment',   'Pending'),
('Anita Singh',   CURRENT_DATE - 7,  CURRENT_DATE - 7,  'Personal emergency',                     'Approved'),
('Monica Nair',   CURRENT_DATE - 14, CURRENT_DATE - 12, 'Family function',                        'Approved'),
('Vikram Bhatia', CURRENT_DATE - 20, CURRENT_DATE - 20, 'Dentist appointment',                    'Rejected');

-- ── 10. GATE QR TOKEN ────────────────────────────────────
INSERT INTO gate_qr (token, academy_name)
VALUES ('sf-gate-2026-test-token-abc123xyz', 'SportFlow Academy Gate')
ON CONFLICT (token) DO NOTHING;

-- ── 11. ACADEMY-SPECIFIC TABLES ─────────────────────────
-- Uses DO $$ to pick up the academy_id created when you signed up
DO $$
DECLARE
  acad_id uuid;
BEGIN
  SELECT id INTO acad_id FROM academies ORDER BY created_at LIMIT 1;
  IF acad_id IS NULL THEN
    RAISE NOTICE 'No academy found — skipping feature_flags, branches, invites. Sign up first!';
    RETURN;
  END IF;

  -- Feature flags — all ON
  INSERT INTO feature_flags (academy_id, feature, enabled) VALUES
  (acad_id, 'attendance',  true),
  (acad_id, 'payments',    true),
  (acad_id, 'trials',      true),
  (acad_id, 'batches',     true),
  (acad_id, 'staff',       true),
  (acad_id, 'reports',     true),
  (acad_id, 'community',   true),
  (acad_id, 'events',      true),
  (acad_id, 'gate_qr',     true)
  ON CONFLICT (academy_id, feature) DO UPDATE SET enabled = true;

  -- Dashboard branch tabs
  INSERT INTO academy_branches (academy_id, name) VALUES
  (acad_id, 'Football'),
  (acad_id, 'Cricket'),
  (acad_id, 'Badminton'),
  (acad_id, 'Tennis'),
  (acad_id, 'Dance'),
  (acad_id, 'Martial Arts'),
  (acad_id, 'Basketball')
  ON CONFLICT (academy_id, name) DO NOTHING;

  -- One pending staff invite (for testing the invite flow)
  INSERT INTO staff_invites (token, academy_id, academy_name, name, access_role, permissions, expires_at, used)
  SELECT
    'test-invite-token-coach-2026',
    acad_id,
    a.name,
    'Kiran Desai',
    'coach',
    ARRAY['attendance.manage','students.view','batches.view'],
    NOW() + INTERVAL '7 days',
    false
  FROM academies a WHERE a.id = acad_id
  ON CONFLICT (token) DO NOTHING;

END;
$$;

-- ── 12. ACTIVATE STUDENTS FOR PORTAL TESTING ────────────
-- Password: Student@123 (hash = sha256('sportflow-2026Student@123'))
UPDATE students
SET
  password_hash  = encode(sha256(('sportflow-2026Student@123')::bytea), 'hex'),
  account_status = 'active',
  join_code      = NULL
WHERE student_code IN ('SA001','SA005','SA007','SA011','SA016');

-- Join codes for pending activation (test at /activate)
UPDATE students SET join_code = 'KD2MV8' WHERE student_code = 'SA002';
UPDATE students SET join_code = 'KV3RX9' WHERE student_code = 'SA006';
UPDATE students SET join_code = 'KB4SY2' WHERE student_code = 'SA009';
UPDATE students SET join_code = 'NG5TZ3' WHERE student_code = 'SA014';
UPDATE students SET join_code = 'RD6UA4' WHERE student_code = 'SA021';
UPDATE students SET join_code = 'DV3MS8' WHERE student_code = 'SA003';
UPDATE students SET join_code = 'FX4NT9' WHERE student_code = 'SA004';
UPDATE students SET join_code = 'GY5PU2' WHERE student_code = 'SA008';
UPDATE students SET join_code = 'HZ6QV3' WHERE student_code = 'SA010';
UPDATE students SET join_code = 'JA7RW4' WHERE student_code = 'SA013';
UPDATE students SET join_code = 'KB8SX5' WHERE student_code = 'SA015';
UPDATE students SET join_code = 'LC9TY6' WHERE student_code = 'SA017';
UPDATE students SET join_code = 'MD2UZ7' WHERE student_code = 'SA018';
UPDATE students SET join_code = 'NE3VA8' WHERE student_code = 'SA019';
UPDATE students SET join_code = 'PF4WB9' WHERE student_code = 'SA020';
UPDATE students SET join_code = 'QG5XC2' WHERE student_code = 'SA022';
UPDATE students SET join_code = 'RH6YD3' WHERE student_code = 'SA023';
UPDATE students SET join_code = 'SJ7ZE4' WHERE student_code = 'SA024';
UPDATE students SET join_code = 'TK8AF5' WHERE student_code = 'SA026';
UPDATE students SET join_code = 'UL9BG6' WHERE student_code = 'SA027';
UPDATE students SET join_code = 'VM2CH7' WHERE student_code = 'SA028';
UPDATE students SET join_code = 'WN3DJ8' WHERE student_code = 'SA029';
UPDATE students SET join_code = 'XP4EK9' WHERE student_code = 'SA030';

-- ── 13. SYNC fee_amount ──────────────────────────────────
UPDATE students SET fee_amount = fees WHERE fee_amount = 0 OR fee_amount IS NULL;

-- ── VERIFY ───────────────────────────────────────────────
-- SELECT student_code, name, sport, batch, account_status FROM students ORDER BY id;
-- SELECT name, sport, COUNT(*) FROM students GROUP BY name, sport HAVING COUNT(*) > 1;
-- SELECT status, COUNT(*) FROM payments GROUP BY status;
-- SELECT * FROM gate_qr;
-- SELECT name, enabled FROM feature_flags ORDER BY feature;
-- SELECT name FROM academy_branches ORDER BY name;
