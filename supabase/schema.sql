-- ============================================================
-- SportFlow CRM — Supabase Schema
-- Run this entire file in Supabase > SQL Editor > New query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- STUDENTS
-- ============================================================
create table if not exists students (
  id          bigserial primary key,
  name        text not null,
  parent      text not null,
  phone       text not null,
  age         integer,
  sport       text not null,
  batch       text not null,
  join_date   date not null default current_date,
  status      text not null default 'Active' check (status in ('Active','Inactive')),
  fees        integer not null default 2000,
  paid_till   date,
  created_at  timestamptz default now()
);

-- ============================================================
-- BATCHES
-- ============================================================
create table if not exists batches (
  id         bigserial primary key,
  name       text not null,
  time       text,
  sports     text[] default '{}',
  coach      text,
  capacity   integer not null default 20,
  enrolled   integer not null default 0,
  waitlist   integer not null default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- STAFF
-- ============================================================
create table if not exists staff (
  id          bigserial primary key,
  name        text not null,
  role        text not null,
  phone       text,
  sports      text[] default '{}',
  salary      integer not null default 20000,
  join_date   date not null default current_date,
  status      text not null default 'Active',
  attendance  integer not null default 100,
  created_at  timestamptz default now()
);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table if not exists payments (
  id          text primary key,   -- invoice number e.g. INV-2026-001
  student_id  bigint references students(id) on delete set null,
  student     text not null,
  amount      integer not null,
  month       text not null,
  date        date,
  status      text not null default 'Pending' check (status in ('Paid','Pending','Overdue')),
  mode        text,
  created_at  timestamptz default now()
);

-- ============================================================
-- TRIALS
-- ============================================================
create table if not exists trials (
  id          bigserial primary key,
  name        text not null,
  parent      text not null,
  phone       text not null,
  sport       text not null,
  trial_date  date not null,
  source      text,
  status      text not null default 'Scheduled' check (status in ('Scheduled','Completed','Cancelled')),
  converted   boolean not null default false,
  follow_up   date,
  created_at  timestamptz default now()
);

-- ============================================================
-- ATTENDANCE
-- ============================================================
create table if not exists attendance (
  id          bigserial primary key,
  date        date not null,
  student_id  bigint not null references students(id) on delete cascade,
  present     boolean not null default false,
  created_at  timestamptz default now(),
  unique(date, student_id)
);

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
create table if not exists announcements (
  id          bigserial primary key,
  title       text not null,
  body        text,
  type        text not null default 'Announcement',
  author      text not null default 'Admin',
  date        date not null default current_date,
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — disable for now (single-tenant SaaS)
-- Enable and add policies when you add auth per-academy
-- ============================================================
alter table students      disable row level security;
alter table batches       disable row level security;
alter table staff         disable row level security;
alter table payments      disable row level security;
alter table trials        disable row level security;
alter table attendance    disable row level security;
alter table announcements disable row level security;

-- ============================================================
-- SEED DATA — 22 students
-- ============================================================
insert into students (name, parent, phone, age, sport, batch, join_date, status, fees, paid_till) values
('Arjun Sharma',     'Rajesh Sharma',   '9876543210', 14, 'Football',    'Morning A', '2025-01-10', 'Active',   2500, '2026-04-30'),
('Priya Patel',      'Suresh Patel',    '9812345678', 12, 'Dance',       'Evening A', '2025-02-15', 'Active',   2000, '2026-03-31'),
('Rahul Verma',      'Anil Verma',      '9898765432', 15, 'Cricket',     'Morning B', '2025-01-20', 'Active',   2500, '2026-05-31'),
('Sneha Iyer',       'Krishnan Iyer',   '9756432109', 13, 'Badminton',   'Evening B', '2025-03-05', 'Active',   1800, '2026-02-28'),
('Dev Malhotra',     'Deepak Malhotra', '9845612378', 16, 'Football',    'Morning A', '2025-01-08', 'Active',   2500, '2026-04-30'),
('Kavya Reddy',      'Srinivas Reddy',  '9823456701', 11, 'Martial Arts','Morning B', '2025-02-20', 'Active',   2200, '2026-05-31'),
('Aditya Singh',     'Vikram Singh',    '9867542310', 14, 'Cricket',     'Morning A', '2025-03-12', 'Active',   2500, '2026-03-31'),
('Nisha Gupta',      'Manoj Gupta',     '9712345678', 10, 'Dance',       'Evening A', '2025-04-01', 'Active',   2000, '2026-04-30'),
('Rohan Joshi',      'Prakash Joshi',   '9934561278', 17, 'Tennis',      'Weekend',   '2025-02-10', 'Inactive', 3000, '2025-12-31'),
('Ananya Mehta',     'Rajiv Mehta',     '9876512340', 13, 'Badminton',   'Evening A', '2025-05-15', 'Active',   1800, '2026-05-31'),
('Karan Kapoor',     'Suniel Kapoor',   '9823045617', 15, 'Football',    'Evening B', '2025-01-25', 'Active',   2500, '2026-04-30'),
('Divya Nair',       'Suresh Nair',     '9745621389', 12, 'Martial Arts','Morning A', '2025-03-18', 'Active',   2200, '2026-05-31'),
('Ishaan Chopra',    'Rajan Chopra',    '9867231450', 16, 'Basketball',  'Evening A', '2025-04-10', 'Active',   2000, '2026-04-30'),
('Pooja Sharma',     'Rakesh Sharma',   '9912345608', 11, 'Dance',       'Evening B', '2025-02-28', 'Active',   2000, '2026-03-31'),
('Yash Tiwari',      'Ramesh Tiwari',   '9876034512', 14, 'Cricket',     'Morning B', '2025-01-30', 'Inactive', 2500, '2026-01-31'),
('Ritika Bansal',    'Pankaj Bansal',   '9834512670', 13, 'Badminton',   'Weekend',   '2025-05-01', 'Active',   1800, '2026-05-31'),
('Varun Khanna',     'Mohit Khanna',    '9745230189', 15, 'Football',    'Morning A', '2025-03-22', 'Active',   2500, '2026-04-30'),
('Shruti Mishra',    'Sunil Mishra',    '9823671450', 10, 'Dance',       'Evening A', '2025-04-18', 'Active',   2000, '2026-04-30'),
('Nikhil Agarwal',   'Dinesh Agarwal',  '9867012345', 16, 'Tennis',      'Weekend',   '2025-02-05', 'Active',   3000, '2026-05-31'),
('Tanvi Srivastava', 'Alok Srivastava', '9912034567', 12, 'Martial Arts','Morning B', '2025-03-30', 'Active',   2200, '2026-04-30'),
('Amit Yadav',       'Satish Yadav',    '9845031278', 13, 'Cricket',     'Morning A', '2025-01-12', 'Active',   2500, '2026-05-31'),
('Meera Pillai',     'Ravi Pillai',     '9756781234', 11, 'Dance',       'Evening B', '2025-04-25', 'Active',   2000, '2026-04-30');

-- ============================================================
-- SEED DATA — Batches
-- ============================================================
insert into batches (name, time, sports, coach, capacity, enrolled, waitlist) values
('Morning A', '6:00 AM – 7:30 AM',           '{Football,Cricket}',      'Suresh Yadav',  25, 18, 2),
('Morning B', '7:30 AM – 9:00 AM',           '{Cricket,"Martial Arts"}', 'Pradeep Kumar', 20, 16, 0),
('Evening A', '4:00 PM – 5:30 PM',           '{Dance,Badminton}',        'Anita Singh',   25, 22, 3),
('Evening B', '5:30 PM – 7:00 PM',           '{Football,Dance}',         'Ravi Shankar',  20, 14, 0),
('Weekend',   'Sat–Sun 8:00 AM – 10:00 AM',  '{Tennis,Badminton}',       'Monica Nair',   15, 12, 1);

-- ============================================================
-- SEED DATA — Staff
-- ============================================================
insert into staff (name, role, phone, sports, salary, join_date, status, attendance) values
('Suresh Yadav',  'Head Coach',    '9823401567', '{Football,Cricket}',         35000, '2024-06-01', 'Active', 96),
('Pradeep Kumar', 'Coach',         '9845612370', '{Cricket,"Martial Arts"}',   28000, '2024-08-15', 'Active', 94),
('Anita Singh',   'Dance Trainer', '9867234501', '{Dance}',                    25000, '2024-09-01', 'Active', 98),
('Ravi Shankar',  'Coach',         '9712345670', '{Football}',                 27000, '2024-07-10', 'Active', 91),
('Monica Nair',   'Coach',         '9934012567', '{Tennis,Badminton}',         26000, '2024-10-01', 'Active', 97),
('Deepak Jha',    'Admin',         '9823456701', '{}',                         20000, '2024-06-01', 'Active', 99);

-- ============================================================
-- SEED DATA — Announcements
-- ============================================================
insert into announcements (title, body, type, author, date) values
('Academy Closed on May 15 – Buddha Purnima', 'Dear Parents, the academy will remain closed on 15th May (Wednesday) for Buddha Purnima. Regular classes resume from 16th May.', 'Holiday', 'Admin', '2026-05-01'),
('Inter-Academy Football Tournament – May 18', 'Exciting news! Our football team will participate in the Inter-Academy Tournament at DY Patil Stadium on May 18. Parents are welcome.', 'Tournament', 'Suresh Yadav', '2026-04-30'),
('Congratulations! Kavya Reddy – State Martial Arts Champion', 'We are extremely proud to announce that Kavya Reddy has won Gold at the State Level Martial Arts Championship!', 'Achievement', 'Admin', '2026-04-28'),
('May Fees Reminder', 'May monthly fees are due by May 10. Please pay via UPI or hand over cash to the reception. Receipts will be generated instantly.', 'Reminder', 'Admin', '2026-04-27'),
('New Batch Starting – Swimming (Beginner)', 'We are launching a beginner Swimming batch from June 1. Limited seats. Registration starts May 10.', 'Announcement', 'Admin', '2026-04-25');

-- ============================================================
-- SEED DATA — Payments (20 records)
-- ============================================================
insert into payments (id, student_id, student, amount, month, date, status, mode) values
('INV-2026-001', 1,  'Arjun Sharma',     2500, 'April 2026', '2026-04-02', 'Paid',    'UPI'),
('INV-2026-002', 3,  'Rahul Verma',      2500, 'April 2026', '2026-04-05', 'Paid',    'Cash'),
('INV-2026-003', 5,  'Dev Malhotra',     2500, 'April 2026', '2026-04-03', 'Paid',    'UPI'),
('INV-2026-004', 6,  'Kavya Reddy',      2200, 'April 2026', '2026-04-08', 'Paid',    'Bank Transfer'),
('INV-2026-005', 7,  'Aditya Singh',     2500, 'April 2026', null,         'Pending', null),
('INV-2026-006', 8,  'Nisha Gupta',      2000, 'April 2026', null,         'Pending', null),
('INV-2026-007', 2,  'Priya Patel',      2000, 'April 2026', null,         'Overdue', null),
('INV-2026-008', 4,  'Sneha Iyer',       1800, 'March 2026', null,         'Overdue', null),
('INV-2026-009', 10, 'Ananya Mehta',     1800, 'April 2026', '2026-04-10', 'Paid',    'UPI'),
('INV-2026-010', 11, 'Karan Kapoor',     2500, 'April 2026', '2026-04-07', 'Paid',    'Cash'),
('INV-2026-011', 12, 'Divya Nair',       2200, 'April 2026', '2026-04-12', 'Paid',    'UPI'),
('INV-2026-012', 13, 'Ishaan Chopra',    2000, 'April 2026', null,         'Pending', null),
('INV-2026-013', 14, 'Pooja Sharma',     2000, 'April 2026', null,         'Overdue', null),
('INV-2026-014', 16, 'Ritika Bansal',    1800, 'April 2026', '2026-04-14', 'Paid',    'UPI'),
('INV-2026-015', 17, 'Varun Khanna',     2500, 'April 2026', '2026-04-06', 'Paid',    'UPI'),
('INV-2026-016', 18, 'Shruti Mishra',    2000, 'April 2026', null,         'Pending', null),
('INV-2026-017', 19, 'Nikhil Agarwal',   3000, 'April 2026', '2026-04-09', 'Paid',    'Bank Transfer'),
('INV-2026-018', 20, 'Tanvi Srivastava', 2200, 'April 2026', '2026-04-11', 'Paid',    'UPI'),
('INV-2026-019', 21, 'Amit Yadav',       2500, 'April 2026', '2026-04-04', 'Paid',    'Cash'),
('INV-2026-020', 22, 'Meera Pillai',     2000, 'April 2026', null,         'Pending', null);

-- ============================================================
-- SEED DATA — Trials
-- ============================================================
insert into trials (name, parent, phone, sport, trial_date, source, status, converted, follow_up) values
('Aarav Kumar',      'Sanjay Kumar', '9801234567', 'Football',    '2026-04-28', 'Instagram',    'Scheduled', false, '2026-05-03'),
('Riya Desai',       'Hiren Desai',  '9834567012', 'Dance',       '2026-04-25', 'Referral',     'Completed', true,  null),
('Kabir Ansari',     'Aslam Ansari', '9867890123', 'Cricket',     '2026-04-30', 'Walk-in',      'Scheduled', false, '2026-05-05'),
('Siya Jain',        'Vinod Jain',   '9812309876', 'Badminton',   '2026-04-22', 'Google',       'Completed', false, '2026-05-01'),
('Aryan Bose',       'Arnab Bose',   '9756781234', 'Martial Arts','2026-05-02', 'Facebook',     'Scheduled', false, '2026-05-07'),
('Navya Sethi',      'Rahul Sethi',  '9823456012', 'Tennis',      '2026-04-20', 'Word of Mouth','Completed', true,  null),
('Dhruv Pandey',     'Ashok Pandey', '9834120567', 'Football',    '2026-05-05', 'Instagram',    'Scheduled', false, '2026-05-10'),
('Isha Chakraborty', 'Tapan C.',     '9867234510', 'Dance',       '2026-04-18', 'Referral',     'Completed', true,  null);

-- ============================================================
-- SEED DATA — Today's attendance (2026-05-01)
-- ============================================================
insert into attendance (date, student_id, present) values
('2026-05-01', 1,  true),
('2026-05-01', 2,  true),
('2026-05-01', 3,  false),
('2026-05-01', 4,  true),
('2026-05-01', 5,  true),
('2026-05-01', 6,  true),
('2026-05-01', 7,  false),
('2026-05-01', 8,  true),
('2026-05-01', 10, true),
('2026-05-01', 11, true),
('2026-05-01', 12, true),
('2026-05-01', 13, false),
('2026-05-01', 14, true),
('2026-05-01', 16, true),
('2026-05-01', 17, true),
('2026-05-01', 18, true),
('2026-05-01', 19, true),
('2026-05-01', 20, true),
('2026-05-01', 21, true),
('2026-05-01', 22, true)
on conflict (date, student_id) do nothing;
