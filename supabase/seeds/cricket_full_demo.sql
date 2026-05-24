-- ══════════════════════════════════════════════════════════════════════
-- CRICKET FULL DEMO SEED — Real-world simulation
-- 6 batches · 5 staff · 200 students · 600 payments · 14 days attendance
-- Realistic payment mix · paid_till set · ~30% suspended · portals active
-- Password for every student portal: 123456
-- Paste entire file into Supabase SQL editor → Run
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════
-- 0. CLEANUP previous demo data (safe re-run)
-- ════════════════════════════════════════
DO $$
DECLARE
  acad UUID := 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf';
  br   UUID := '7343796b-ac5a-4368-b5c8-8e0629bcaad6';
  demo_ids BIGINT[];
BEGIN
  SELECT ARRAY(SELECT id FROM students WHERE student_code ~ '^CK\d{4}$' AND academy_id = acad)
  INTO demo_ids;

  IF array_length(demo_ids, 1) IS NOT NULL THEN
    DELETE FROM attendance  WHERE student_id = ANY(demo_ids);
    DELETE FROM payments    WHERE student_id = ANY(demo_ids);
    DELETE FROM students    WHERE id         = ANY(demo_ids);
  END IF;

  DELETE FROM staff_auth WHERE staff_code LIKE 'CKS%' AND staff_id IN (
    SELECT id FROM staff WHERE academy_id = acad AND phone LIKE '9800000%'
  );
  DELETE FROM staff WHERE academy_id = acad AND phone LIKE '9800000%';
  -- delete demo batches (also CK-U16E if we created it; existing un-coded U16 stays)
  DELETE FROM batches WHERE academy_id = acad AND code LIKE 'CK-%';

  RAISE NOTICE 'Cleanup done';
END $$;

-- ════════════════════════════════════════
-- 1. MAIN SEED
-- ════════════════════════════════════════
DO $$
DECLARE
  acad UUID := 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf';
  br   UUID := '7343796b-ac5a-4368-b5c8-8e0629bcaad6';

  b_u10 BIGINT; b_u12 BIGINT; b_u14 BIGINT;
  b_u16 BIGINT;                -- looked up / created below
  b_u19 BIGINT; b_lad BIGINT;

  st1 BIGINT; st2 BIGINT; st3 BIGINT; st4 BIGINT; st5 BIGINT;

  fn  TEXT[] := ARRAY['Aarav','Vivaan','Aditya','Vihaan','Arjun',
                      'Sai','Reyansh','Ayaan','Krishna','Ishaan',
                      'Shaurya','Atharv','Dhruv','Kabir','Ritvik',
                      'Yuvraj','Ranveer','Parth','Laksh','Shivansh'];
  ln  TEXT[] := ARRAY['Sharma','Patel','Singh','Kumar','Gupta',
                      'Verma','Joshi','Mehta','Yadav','Mishra'];
  pf  TEXT[] := ARRAY['Rajesh','Suresh','Mohan','Rakesh','Dinesh',
                      'Prakash','Amit','Vijay','Sunil','Anil'];
  gfn TEXT[] := ARRAY['Priya','Sneha','Kavya','Pooja','Ananya',
                      'Riya','Divya','Meera','Nisha','Shreya',
                      'Tanvi','Aditi','Simran','Kiara','Deepika'];
  gpf TEXT[] := ARRAY['Sunita','Geeta','Anita','Rekha','Sushma',
                      'Kiran','Sonia','Asha','Pushpa','Malti'];
  modes TEXT[] := ARRAY['Cash','UPI','Bank Transfer'];

  i INT; b INT; jitter INT;
  bat_id BIGINT; bat_nm TEXT; age_v INT; fee_v INT;
  sname TEXT; pname TEXT; ph TEXT; jdate DATE;
  sid BIGINT;
  pwd_hash TEXT;
  m1 TEXT; m2 TEXT; m3 TEXT;
  p1s TEXT; p2s TEXT; p3s TEXT;
  p1d DATE; p2d DATE; p3d DATE;
  paid_till_v DATE;
  status_v TEXT;
BEGIN

-- ════════════════════════════════════════
-- 1.1 BATCHES
-- ════════════════════════════════════════
INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
VALUES ('Cricket U10 Morning',ARRAY['Cricket'],'Amit Sharma',30,0,0,'06:00','07:30',ARRAY['Mon','Wed','Fri'],8,10,'Ground A',acad,br,'CK-U10',2000,'monthly')
RETURNING id INTO b_u10;

INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
VALUES ('Cricket U12 Morning',ARRAY['Cricket'],'Amit Sharma',35,0,0,'07:30','09:00',ARRAY['Mon','Wed','Fri'],11,12,'Ground A',acad,br,'CK-U12',2000,'monthly')
RETURNING id INTO b_u12;

INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
VALUES ('Cricket U14 Afternoon',ARRAY['Cricket'],'Suresh Mehta',40,0,0,'15:00','17:00',ARRAY['Tue','Thu','Sat'],13,14,'Ground B',acad,br,'CK-U14',2500,'monthly')
RETURNING id INTO b_u14;

INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
VALUES ('Cricket U19 Advanced',ARRAY['Cricket'],'Rohit Kapoor',30,0,0,'17:00','19:00',ARRAY['Mon','Tue','Thu','Sat'],16,19,'Main Ground',acad,br,'CK-U19',3500,'monthly')
RETURNING id INTO b_u19;

INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
VALUES ('Cricket Ladies',ARRAY['Cricket'],'Priya Patel',20,0,0,'08:00','10:00',ARRAY['Mon','Wed','Fri','Sun'],14,30,'Ground C',acad,br,'CK-LAD',2500,'monthly')
RETURNING id INTO b_lad;

-- U16 Evening: look up by name (created above as CK-U16E) or create
SELECT id INTO b_u16 FROM batches
WHERE academy_id = acad AND branch_id = br AND name = 'Cricket U16 Evening'
LIMIT 1;

IF b_u16 IS NULL THEN
  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Cricket U16 Evening',ARRAY['Cricket'],'Suresh Mehta',50,0,0,'16:00','18:00',ARRAY['Mon','Wed','Fri'],15,16,'Ground B',acad,br,'CK-U16E',2500,'monthly')
  RETURNING id INTO b_u16;
  RAISE NOTICE 'Created new U16 Evening batch id=%', b_u16;
ELSE
  RAISE NOTICE 'Using existing U16 Evening batch id=%', b_u16;
END IF;

-- ════════════════════════════════════════
-- 1.2 STAFF + PERMISSIONS
-- ════════════════════════════════════════
INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
VALUES ('Rohit Kapoor','Head Coach','9800000001',ARRAY['Cricket'],45000,'2023-01-15','Active',95,acad,br)
RETURNING id INTO st1;
INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
VALUES (st1,'CKS001','active','coach','branch_manager',
  '["dashboard.view","students.view","students.manage","attendance.manage","payments.view","payments.manage","trials.manage","batches.view","batches.manage","reports.view","staff.manage","settings.manage","community.manage","events.manage"]'::jsonb);

INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
VALUES ('Suresh Mehta','Senior Coach','9800000002',ARRAY['Cricket'],35000,'2023-03-10','Active',90,acad,br)
RETURNING id INTO st2;
INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
VALUES (st2,'CKS002','active','coach','coach',
  '["dashboard.view","students.view","attendance.manage","batches.view","reports.view"]'::jsonb);

INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
VALUES ('Amit Sharma','Junior Coach','9800000003',ARRAY['Cricket'],25000,'2023-06-01','Active',88,acad,br)
RETURNING id INTO st3;
INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
VALUES (st3,'CKS003','active','coach','coach',
  '["dashboard.view","students.view","attendance.manage","batches.view"]'::jsonb);

INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
VALUES ('Priya Patel','Ladies Coach','9800000004',ARRAY['Cricket'],28000,'2023-08-15','Active',91,acad,br)
RETURNING id INTO st4;
INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
VALUES (st4,'CKS004','active','coach','coach',
  '["dashboard.view","students.view","attendance.manage","batches.view","reports.view"]'::jsonb);

INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
VALUES ('Neha Gupta','Office Manager','9800000005',ARRAY['Cricket'],22000,'2024-01-10','Active',96,acad,br)
RETURNING id INTO st5;
INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
VALUES (st5,'CKS005','active','office','office',
  '["dashboard.view","students.view","students.manage","payments.view","payments.manage","trials.manage","reports.view"]'::jsonb);

-- ════════════════════════════════════════
-- 1.3 Pre-compute one bcrypt hash for password "123456"
--     (reuse for all 200 students → keeps seed under 30 s)
-- ════════════════════════════════════════
pwd_hash := crypt('123456', gen_salt('bf', 8));

-- ════════════════════════════════════════
-- 1.4 STUDENTS + PAYMENTS  (real-world simulation)
--   Bucket distribution (i % 10) — 70% Active / 30% Suspended:
--     0-4 (50%) — fully paid up            → Active, paid_till future
--     5   (10%) — paid up + this month due → Active, paid_till future
--     6   (10%) — 1–30 days overdue        → Active, mild miss
--     7   (10%) — 31–60 days overdue       → Suspended
--     8   (10%) — 61–90 days overdue       → Suspended
--     9   (10%) — 90+ days overdue         → Suspended
-- ════════════════════════════════════════
FOR i IN 1..200 LOOP

  -- Batch assignment
  IF    i <= 30  THEN bat_id:=b_u10; bat_nm:='Cricket U10 Morning';   age_v:=8  +(i%3); fee_v:=2000;
  ELSIF i <= 65  THEN bat_id:=b_u12; bat_nm:='Cricket U12 Morning';   age_v:=11 +(i%2); fee_v:=2000;
  ELSIF i <= 105 THEN bat_id:=b_u14; bat_nm:='Cricket U14 Afternoon'; age_v:=13 +(i%2); fee_v:=2500;
  ELSIF i <= 155 THEN bat_id:=b_u16; bat_nm:='Cricket U16 Evening';   age_v:=15 +(i%2); fee_v:=2500;
  ELSIF i <= 185 THEN bat_id:=b_u19; bat_nm:='Cricket U19 Advanced';  age_v:=17 +(i%3); fee_v:=3500;
  ELSE                bat_id:=b_lad; bat_nm:='Cricket Ladies';         age_v:=16 +(i%5); fee_v:=2500;
  END IF;

  -- Name
  IF i > 185 THEN
    sname := gfn[((i-186)%15)+1] || ' ' || ln[((i-186)/15)+1];
    pname := gpf[((i-186)%10)+1] || ' ' || ln[((i-186)/15)+1];
  ELSE
    sname := fn[((i-1)%20)+1] || ' ' || ln[((i-1)/20)+1];
    pname := pf[((i-1)%10)+1] || ' ' || ln[((i-1)/20)+1];
  END IF;

  ph    := '9' || lpad((876540000+i)::TEXT,9,'0');
  jdate := '2024-01-01'::DATE + ((i*2)%300) * INTERVAL '1 day';

  -- Determine payment bucket + pattern (spread across all aging buckets)
  -- Use (i + i/20) so students with the same first name don't all land in the
  -- same bucket — gives realistic mix across last-name cohorts.
  b      := (i + (i / 20)) % 10;
  jitter := (i % 7) - 3;
  m1 := TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM');
  m2 := TO_CHAR(CURRENT_DATE - INTERVAL '1 month',  'YYYY-MM');
  m3 := TO_CHAR(CURRENT_DATE,                        'YYYY-MM');

  IF b IN (0,1,2,3,4) THEN          -- 50% fully paid current month
    p1s:='Paid';    p1d:= CURRENT_DATE - 60 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 30 + jitter;
    p3s:='Paid';    p3d:= CURRENT_DATE -  5 + jitter;
    paid_till_v := p3d + 30;
    status_v    := 'Active';

  ELSIF b = 5 THEN                  -- 10% paid + this month not yet due
    p1s:='Paid';    p1d:= CURRENT_DATE - 50 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 20 + jitter;
    p3s:='Pending'; p3d:= NULL;
    paid_till_v := p2d + 30;        -- ~10 days future
    status_v    := 'Active';

  ELSIF b = 6 THEN                  -- 10% Active, 1–30 days overdue
    p1s:='Paid';    p1d:= CURRENT_DATE - 70 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 45 + jitter;
    p3s:='Pending'; p3d:= NULL;
    paid_till_v := p2d + 30;        -- ~15 days past
    status_v    := 'Active';

  ELSIF b = 7 THEN                  -- 10% Suspended, 31–60 days overdue
    p1s:='Paid';    p1d:= CURRENT_DATE - 90 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 75 + jitter;
    p3s:='Overdue'; p3d:= NULL;
    m3 := TO_CHAR(CURRENT_DATE - INTERVAL '1 month', 'YYYY-MM');
    paid_till_v := p2d + 30;        -- ~45 days past
    status_v    := 'Suspended';

  ELSIF b = 8 THEN                  -- 10% Suspended, 61–90 days overdue
    p1s:='Paid';    p1d:= CURRENT_DATE - 120 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 105 + jitter;
    p3s:='Overdue'; p3d:= NULL;
    m2 := TO_CHAR(CURRENT_DATE - INTERVAL '3 months', 'YYYY-MM');
    m3 := TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM');
    paid_till_v := p2d + 30;        -- ~75 days past
    status_v    := 'Suspended';

  ELSE                              -- 10% Suspended, 90+ days overdue
    p1s:='Paid';    p1d:= CURRENT_DATE - 160 + jitter;
    p2s:='Paid';    p2d:= CURRENT_DATE - 140 + jitter;
    p3s:='Overdue'; p3d:= NULL;
    m1 := TO_CHAR(CURRENT_DATE - INTERVAL '5 months', 'YYYY-MM');
    m2 := TO_CHAR(CURRENT_DATE - INTERVAL '4 months', 'YYYY-MM');
    m3 := TO_CHAR(CURRENT_DATE - INTERVAL '3 months', 'YYYY-MM');
    paid_till_v := p2d + 30;        -- ~110 days past
    status_v    := 'Suspended';
  END IF;

  -- Insert student (portal active, password 123456)
  INSERT INTO students (
    name,parent,phone,age,sport,batch,batch_id,join_date,
    status,fees,fee_amount,paid_till,
    academy_id,branch_id,student_code,
    account_status,password_hash
  )
  VALUES (
    sname,pname,ph,age_v,'Cricket',bat_nm,bat_id,jdate,
    status_v,fee_v,fee_v,paid_till_v,
    acad,br,'CK'||lpad(i::TEXT,4,'0'),
    'active',pwd_hash
  )
  RETURNING id INTO sid;

  -- 3 payments per student
  INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
  VALUES ('DM'||lpad(i::TEXT,4,'0')||'-1', sid, sname, fee_v, m1, p1d, p1s, modes[1], 'monthly', acad);

  INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
  VALUES ('DM'||lpad(i::TEXT,4,'0')||'-2', sid, sname, fee_v, m2, p2d, p2s, modes[2], 'monthly', acad);

  INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
  VALUES ('DM'||lpad(i::TEXT,4,'0')||'-3', sid, sname, fee_v, m3, p3d, p3s, modes[3], 'monthly', acad);

END LOOP;

-- ════════════════════════════════════════
-- 1.5 UPDATE ENROLLED COUNTS
-- ════════════════════════════════════════
UPDATE batches SET enrolled = (
  SELECT COUNT(*) FROM students s WHERE s.batch_id = batches.id
) WHERE academy_id = acad;

RAISE NOTICE 'Seeded: 5 batches, 5 staff, 200 students, 600 payments — portals active (pwd 123456)';
END $$;

-- ════════════════════════════════════════
-- 2. ATTENDANCE — last 14 days (only on batch training days)
-- ════════════════════════════════════════
INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
SELECT
  d::DATE,
  s.id,
  s.batch_id,
  st <> 'Absent',
  st,
  CASE
    WHEN b.code IN ('CK-U10','CK-U12') THEN 'Amit Sharma'
    WHEN b.code = 'CK-U14'             THEN 'Suresh Mehta'
    WHEN b.code = 'CK-U19'             THEN 'Rohit Kapoor'
    WHEN b.code = 'CK-LAD'             THEN 'Priya Patel'
    ELSE 'Rohit Kapoor'                                   -- U16E + fallback
  END
FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day'::INTERVAL) d
CROSS JOIN LATERAL (
  SELECT s.id, s.batch_id,
    CASE
      WHEN random() < 0.75 THEN 'Present'
      WHEN random() < 0.55 THEN 'Late'
      ELSE 'Absent'
    END AS st
  FROM students s
  WHERE s.academy_id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'
    AND s.sport = 'Cricket'
    AND s.student_code ~ '^CK\d{4}$'
    AND s.status = 'Active'                               -- skip suspended kids
) s
JOIN batches b ON b.id = s.batch_id
WHERE to_char(d, 'Dy') = ANY(b.days)                       -- only batch training days
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════
-- 3. VERIFY
-- ════════════════════════════════════════
-- Per-batch student counts (should be 30/35/40/50/30/15 = 200)
SELECT b.name, COUNT(s.id) AS students
FROM batches b
LEFT JOIN students s ON s.batch_id = b.id AND s.student_code ~ '^CK\d{4}$'
WHERE b.academy_id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'
  AND (b.code LIKE 'CK-%' OR b.name = 'Cricket U16 Evening')
GROUP BY b.name
ORDER BY b.name;

-- Status & payment breakdown
SELECT 'students' AS what, status, COUNT(*) AS n
FROM students WHERE student_code ~ '^CK\d{4}$'
GROUP BY status
UNION ALL
SELECT 'payments', status, COUNT(*)
FROM payments WHERE student_id IN (SELECT id FROM students WHERE student_code ~ '^CK\d{4}$')
GROUP BY status
ORDER BY what, status;
