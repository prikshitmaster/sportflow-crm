-- ══════════════════════════════════════════════════════════════════════════
-- FOOTBALL · BRANCH 3 — FULL DEMO SEED
-- ══════════════════════════════════════════════════════════════════════════
-- Creates a complete, presentation-ready branch:
--   • 1 new branch      — Football / Branch 3
--   • 6 batches         — U8 · U10 · U12 · U14 · U16 Elite · Girls Squad
--   • 6 staff           — head coach, 3 coaches, GK coach, centre manager
--                         (all with working staff logins)
--   • 200 students      — portal active, password 123456
--   • 600 payments      — realistic paid / pending / overdue aging mix
--   • ~21 days student attendance (only on each batch's real training days)
--   • ~21 days coach attendance (staff_checkins clock-in / clock-out)
--   • 600 skill assessments  — 3 months × 200 students, real football skills
--   • ~1200 session feedback rows (coach pulse + spotlights)
--   • 600 player goals  — 3 months × 200 students
--   • 30 trials         — full pipeline: new → scheduled → converted
--   • 6 leave requests  — 3 still Pending so the dashboard card shows up
--   • 5 announcements   — branch-scoped
--   • weekly schedules  — current + next week per batch
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this ENTIRE file → Run.
--   Takes ~20-40 s. Safe to re-run: section 1 removes the previous run first.
--
-- SAFETY
--   Every delete is keyed to this seed's own markers (student_code 'FB3nnnn',
--   batch code 'FB3-%', staff phone '97000031%'). Your existing Branch 1 /
--   Branch 2 data is never touched.
--
-- TO REMOVE THIS DEMO LATER
--   Run section 1 (CLEANUP) on its own, then:
--     DELETE FROM sport_branches WHERE sport_name='Football' AND branch_name='Branch 3';
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- 0. CONTEXT — resolve the academy and create the branch
-- ══════════════════════════════════════════════════════════════════════════
-- The academy is auto-detected as the one that already owns Football branches.
-- If you have more than one academy, replace the SELECT below with a literal:
--   acad := 'your-academy-uuid'::uuid;
DO $$
DECLARE
  acad UUID;
  br   UUID;
  n    INT;
BEGIN
  SELECT academy_id INTO acad
  FROM sport_branches
  WHERE sport_name = 'Football'
  GROUP BY academy_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF acad IS NULL THEN
    SELECT id INTO acad FROM academies ORDER BY created_at LIMIT 1;
  END IF;

  IF acad IS NULL THEN
    RAISE EXCEPTION 'Could not resolve an academy — set acad manually at the top of section 0';
  END IF;

  -- Make sure Football is in the academy's sport catalog
  INSERT INTO academy_sports (academy_id, sport_name)
  VALUES (acad, 'Football')
  ON CONFLICT (academy_id, sport_name) DO NOTHING;

  -- Create Branch 3 (idempotent)
  INSERT INTO sport_branches (academy_id, sport_name, branch_name)
  VALUES (acad, 'Football', 'Branch 3')
  ON CONFLICT (academy_id, sport_name, branch_name) DO NOTHING;

  SELECT id INTO br FROM sport_branches
  WHERE academy_id = acad AND sport_name = 'Football' AND branch_name = 'Branch 3';

  SELECT COUNT(*) INTO n FROM sport_branches
  WHERE academy_id = acad AND sport_name = 'Football';

  RAISE NOTICE 'Academy   : %', acad;
  RAISE NOTICE 'Branch 3  : %', br;
  RAISE NOTICE 'Football now has % branches', n;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. CLEANUP — remove a previous run of THIS seed only
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  acad UUID;
  br   UUID;
  sids BIGINT[];
  stids BIGINT[];
  bids BIGINT[];
BEGIN
  SELECT id, academy_id INTO br, acad FROM sport_branches
  WHERE sport_name = 'Football' AND branch_name = 'Branch 3' LIMIT 1;
  IF br IS NULL THEN RAISE EXCEPTION 'Branch 3 missing — run section 0 first'; END IF;

  SELECT ARRAY(SELECT id FROM students WHERE academy_id = acad AND student_code ~ '^FB3\d{4}$') INTO sids;
  SELECT ARRAY(SELECT id FROM staff    WHERE academy_id = acad AND phone LIKE '97000031%')      INTO stids;
  SELECT ARRAY(SELECT id FROM batches  WHERE academy_id = acad AND code LIKE 'FB3-%')           INTO bids;

  IF array_length(sids, 1) IS NOT NULL THEN
    IF to_regclass('public.session_feedback')  IS NOT NULL THEN DELETE FROM session_feedback  WHERE student_id = ANY(sids); END IF;
    IF to_regclass('public.skill_assessments') IS NOT NULL THEN DELETE FROM skill_assessments WHERE student_id = ANY(sids); END IF;
    IF to_regclass('public.player_goals')      IS NOT NULL THEN DELETE FROM player_goals      WHERE student_id = ANY(sids); END IF;
    IF to_regclass('public.student_batches')   IS NOT NULL THEN DELETE FROM student_batches   WHERE student_id = ANY(sids); END IF;
    DELETE FROM attendance WHERE student_id = ANY(sids);
    DELETE FROM payments   WHERE student_id = ANY(sids);
    DELETE FROM students   WHERE id         = ANY(sids);
  END IF;

  IF array_length(stids, 1) IS NOT NULL THEN
    IF to_regclass('public.staff_checkins') IS NOT NULL THEN DELETE FROM staff_checkins  WHERE staff_id = ANY(stids); END IF;
    IF to_regclass('public.leave_requests') IS NOT NULL THEN DELETE FROM leave_requests  WHERE staff_id = ANY(stids); END IF;
    DELETE FROM staff_auth WHERE staff_id = ANY(stids);
    DELETE FROM staff      WHERE id       = ANY(stids);
  END IF;

  IF array_length(bids, 1) IS NOT NULL AND to_regclass('public.weekly_schedules') IS NOT NULL THEN
    DELETE FROM weekly_schedules WHERE batch_id = ANY(bids);
  END IF;

  DELETE FROM trials        WHERE branch_id = br;
  DELETE FROM announcements WHERE branch_id = br;
  DELETE FROM batches       WHERE academy_id = acad AND code LIKE 'FB3-%';

  RAISE NOTICE 'Cleanup done — % students, % staff, % batches removed',
    COALESCE(array_length(sids,1),0), COALESCE(array_length(stids,1),0), COALESCE(array_length(bids,1),0);
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 2-4. BATCHES · STAFF · STUDENTS · PAYMENTS
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  acad UUID;
  br   UUID;

  b_u8 BIGINT; b_u10 BIGINT; b_u12 BIGINT; b_u14 BIGINT; b_u16 BIGINT; b_grl BIGINT;
  st1 BIGINT; st2 BIGINT; st3 BIGINT; st4 BIGINT; st5 BIGINT; st6 BIGINT;

  fn  TEXT[] := ARRAY['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan',
                      'Krishna','Ishaan','Shaurya','Atharv','Dhruv','Kabir','Ritvik',
                      'Yuvraj','Ranveer','Parth','Laksh','Shivansh'];
  ln  TEXT[] := ARRAY['Sharma','Patel','Singh','Kumar','Gupta','Verma','Joshi','Mehta',
                      'Yadav','Mishra'];
  pf  TEXT[] := ARRAY['Rajesh','Suresh','Mohan','Rakesh','Dinesh','Prakash','Amit','Vijay',
                      'Sunil','Anil'];
  gfn TEXT[] := ARRAY['Priya','Sneha','Kavya','Pooja','Ananya','Riya','Divya','Meera',
                      'Nisha','Shreya','Tanvi','Aditi','Simran','Kiara','Deepika'];
  gpf TEXT[] := ARRAY['Sunita','Geeta','Anita','Rekha','Sushma','Kiran','Sonia','Asha',
                      'Pushpa','Malti'];
  modes TEXT[] := ARRAY['Cash','UPI','Bank Transfer'];
  pos   TEXT[] := ARRAY['GK','RB','RCB','LCB','LB','CDM','LCAM','RCAM','LW','ST','RW'];
  feet  TEXT[] := ARRAY['Right','Right','Right','Left','Both'];

  i INT; b INT; jitter INT;
  bat_id BIGINT; bat_nm TEXT; age_v INT; fee_v INT;
  sname TEXT; pname TEXT; ph TEXT; jdate DATE;
  sid BIGINT; pwd_hash TEXT;
  m1 TEXT; m2 TEXT; m3 TEXT;
  p1s TEXT; p2s TEXT; p3s TEXT;
  p1d DATE; p2d DATE; p3d DATE;
  paid_till_v DATE; status_v TEXT; susp_since DATE;
  has_pos BOOL; has_phys BOOL; has_susp BOOL;
BEGIN
  SELECT id, academy_id INTO br, acad FROM sport_branches
  WHERE sport_name = 'Football' AND branch_name = 'Branch 3' LIMIT 1;

  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='position')        INTO has_pos;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='height_cm')       INTO has_phys;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='suspended_since') INTO has_susp;

  -- ── 2. BATCHES ─────────────────────────────────────────────────────────
  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football U8 Juniors',ARRAY['Football'],'Nikhil Rawat',30,0,0,'06:00','07:15',ARRAY['Mon','Wed','Fri'],6,8,'Turf 1',acad,br,'FB3-U08',1800,'monthly')
  RETURNING id INTO b_u8;

  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football U10 Morning',ARRAY['Football'],'Nikhil Rawat',35,0,0,'07:15','08:30',ARRAY['Mon','Wed','Fri'],9,10,'Turf 1',acad,br,'FB3-U10',2000,'monthly')
  RETURNING id INTO b_u10;

  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football U12 Evening',ARRAY['Football'],'Imran Sheikh',40,0,0,'16:00','17:30',ARRAY['Tue','Thu','Sat'],11,12,'Turf 2',acad,br,'FB3-U12',2200,'monthly')
  RETURNING id INTO b_u12;

  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football U14 Evening',ARRAY['Football'],'Imran Sheikh',45,0,0,'16:30','18:00',ARRAY['Mon','Wed','Fri'],13,14,'Turf 2',acad,br,'FB3-U14',2500,'monthly')
  RETURNING id INTO b_u14;

  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football U16 Elite',ARRAY['Football'],'Vikas Bhardwaj',35,0,0,'17:30','19:30',ARRAY['Mon','Tue','Thu','Sat'],15,17,'Main Ground',acad,br,'FB3-U16',3200,'monthly')
  RETURNING id INTO b_u16;

  INSERT INTO batches (name,sports,coach,capacity,enrolled,waitlist,start_time,end_time,days,age_min,age_max,ground,academy_id,branch_id,code,default_fee,default_plan)
  VALUES ('Football Girls Squad',ARRAY['Football'],'Meera Joshi',25,0,0,'08:00','09:30',ARRAY['Tue','Thu','Sun'],12,18,'Turf 1',acad,br,'FB3-GRL',2400,'monthly')
  RETURNING id INTO b_grl;

  -- ── 3. STAFF + LOGINS ──────────────────────────────────────────────────
  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Vikas Bhardwaj','Head Coach','9700003101',ARRAY['Football'],52000,'2023-02-01','Active',96,acad,br)
  RETURNING id INTO st1;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st1,'FB3S001','active','coach','branch_manager',
    '["dashboard.view","students.view","students.manage","attendance.manage","payments.view","payments.manage","trials.manage","batches.view","batches.manage","reports.view","staff.manage","settings.manage","community.manage","events.manage","training.manage"]'::jsonb);

  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Imran Sheikh','Senior Coach','9700003102',ARRAY['Football'],38000,'2023-05-15','Active',93,acad,br)
  RETURNING id INTO st2;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st2,'FB3S002','active','coach','coach',
    '["dashboard.view","students.view","attendance.manage","batches.view","reports.view","training.manage"]'::jsonb);

  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Nikhil Rawat','Coach','9700003103',ARRAY['Football'],28000,'2023-09-01','Active',89,acad,br)
  RETURNING id INTO st3;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st3,'FB3S003','active','coach','coach',
    '["dashboard.view","students.view","attendance.manage","batches.view","training.manage"]'::jsonb);

  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Sandeep Chauhan','Goalkeeping Coach','9700003104',ARRAY['Football'],26000,'2024-01-20','Active',87,acad,br)
  RETURNING id INTO st4;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st4,'FB3S004','active','coach','coach',
    '["dashboard.view","students.view","attendance.manage","batches.view"]'::jsonb);

  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Meera Joshi','Girls Squad Coach','9700003105',ARRAY['Football'],30000,'2024-03-10','Active',94,acad,br)
  RETURNING id INTO st5;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st5,'FB3S005','active','coach','coach',
    '["dashboard.view","students.view","attendance.manage","batches.view","reports.view"]'::jsonb);

  INSERT INTO staff (name,role,phone,sports,salary,join_date,status,attendance,academy_id,branch_id)
  VALUES ('Anjali Verma','Centre Manager','9700003106',ARRAY['Football'],24000,'2024-06-01','Active',97,acad,br)
  RETURNING id INTO st6;
  INSERT INTO staff_auth (staff_id,staff_code,status,staff_type,access_role,permissions)
  VALUES (st6,'FB3S006','active','office','office',
    '["dashboard.view","students.view","students.manage","payments.view","payments.manage","trials.manage","reports.view","community.manage"]'::jsonb);

  -- ── 4. STUDENTS + PAYMENTS ─────────────────────────────────────────────
  -- Payment bucket distribution (70% Active / 30% Suspended):
  --   0-4 (50%) fully paid       6 (10%) 1-30d overdue, Active
  --   5   (10%) current not due  7 (10%) 31-60d overdue, Suspended
  --                              8 (10%) 61-90d overdue, Suspended
  --                              9 (10%) 90d+   overdue, Suspended
  pwd_hash := crypt('123456', gen_salt('bf', 8));

  FOR i IN 1..200 LOOP
    IF    i <= 30  THEN bat_id:=b_u8;  bat_nm:='Football U8 Juniors';  age_v:=6 +(i%3); fee_v:=1800;
    ELSIF i <= 65  THEN bat_id:=b_u10; bat_nm:='Football U10 Morning'; age_v:=9 +(i%2); fee_v:=2000;
    ELSIF i <= 105 THEN bat_id:=b_u12; bat_nm:='Football U12 Evening'; age_v:=11+(i%2); fee_v:=2200;
    ELSIF i <= 150 THEN bat_id:=b_u14; bat_nm:='Football U14 Evening'; age_v:=13+(i%2); fee_v:=2500;
    ELSIF i <= 185 THEN bat_id:=b_u16; bat_nm:='Football U16 Elite';   age_v:=15+(i%3); fee_v:=3200;
    ELSE                bat_id:=b_grl; bat_nm:='Football Girls Squad'; age_v:=12+(i%6); fee_v:=2400;
    END IF;

    IF i > 185 THEN
      sname := gfn[((i-186)%15)+1] || ' ' || ln[((i-186)/15)+1];
      pname := gpf[((i-186)%10)+1] || ' ' || ln[((i-186)/15)+1];
    ELSE
      sname := fn[((i-1)%20)+1] || ' ' || ln[((i-1)/20)+1];
      pname := pf[((i-1)%10)+1] || ' ' || ln[((i-1)/20)+1];
    END IF;

    ph    := '9' || lpad((700310000+i)::TEXT, 9, '0');
    jdate := '2024-02-01'::DATE + ((i*3)%420) * INTERVAL '1 day';

    b      := (i + (i / 20)) % 10;
    jitter := (i % 7) - 3;
    m1 := TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM');
    m2 := TO_CHAR(CURRENT_DATE - INTERVAL '1 month',  'YYYY-MM');
    m3 := TO_CHAR(CURRENT_DATE,                       'YYYY-MM');
    susp_since := NULL;

    IF b IN (0,1,2,3,4) THEN
      p1s:='Paid';    p1d:= CURRENT_DATE - 60 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 30 + jitter;
      p3s:='Paid';    p3d:= CURRENT_DATE -  5 + jitter;
      paid_till_v := p3d + 30;  status_v := 'Active';
    ELSIF b = 5 THEN
      p1s:='Paid';    p1d:= CURRENT_DATE - 50 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 20 + jitter;
      p3s:='Pending'; p3d:= NULL;
      paid_till_v := p2d + 30;  status_v := 'Active';
    ELSIF b = 6 THEN
      p1s:='Paid';    p1d:= CURRENT_DATE - 70 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 45 + jitter;
      p3s:='Pending'; p3d:= NULL;
      paid_till_v := p2d + 30;  status_v := 'Active';
    ELSIF b = 7 THEN
      p1s:='Paid';    p1d:= CURRENT_DATE - 90 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 75 + jitter;
      p3s:='Overdue'; p3d:= NULL;
      m3 := TO_CHAR(CURRENT_DATE - INTERVAL '1 month', 'YYYY-MM');
      paid_till_v := p2d + 30;  status_v := 'Suspended'; susp_since := paid_till_v + 7;
    ELSIF b = 8 THEN
      p1s:='Paid';    p1d:= CURRENT_DATE - 120 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 105 + jitter;
      p3s:='Overdue'; p3d:= NULL;
      m2 := TO_CHAR(CURRENT_DATE - INTERVAL '3 months', 'YYYY-MM');
      m3 := TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM');
      paid_till_v := p2d + 30;  status_v := 'Suspended'; susp_since := paid_till_v + 7;
    ELSE
      p1s:='Paid';    p1d:= CURRENT_DATE - 160 + jitter;
      p2s:='Paid';    p2d:= CURRENT_DATE - 140 + jitter;
      p3s:='Overdue'; p3d:= NULL;
      m1 := TO_CHAR(CURRENT_DATE - INTERVAL '5 months', 'YYYY-MM');
      m2 := TO_CHAR(CURRENT_DATE - INTERVAL '4 months', 'YYYY-MM');
      m3 := TO_CHAR(CURRENT_DATE - INTERVAL '3 months', 'YYYY-MM');
      paid_till_v := p2d + 30;  status_v := 'Suspended'; susp_since := paid_till_v + 7;
    END IF;

    INSERT INTO students (
      name,parent,phone,age,sport,batch,batch_id,join_date,
      status,fees,fee_amount,paid_till,
      academy_id,branch_id,student_code,account_status,password_hash
    ) VALUES (
      sname,pname,ph,age_v,'Football',bat_nm,bat_id,jdate,
      status_v,fee_v,fee_v,paid_till_v,
      acad,br,'FB3'||lpad(i::TEXT,4,'0'),'active',pwd_hash
    ) RETURNING id INTO sid;

    -- Optional profile columns, only if this DB has them
    IF has_pos THEN
      EXECUTE 'UPDATE students SET "position" = $1 WHERE id = $2'
        USING pos[(i % 11) + 1], sid;
    END IF;
    IF has_phys THEN
      EXECUTE 'UPDATE students SET height_cm = $1, weight_kg = $2, preferred_foot = $3 WHERE id = $4'
        USING 110 + age_v * 4 + (i % 7), 20 + age_v * 2 + (i % 5), feet[(i % 5) + 1], sid;
    END IF;
    IF has_susp AND susp_since IS NOT NULL THEN
      EXECUTE 'UPDATE students SET suspended_since = $1 WHERE id = $2' USING susp_since, sid;
    END IF;

    -- Multi-batch enrolment mirror (Attendance page reads this)
    IF to_regclass('public.student_batches') IS NOT NULL THEN
      INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
      VALUES (sid, bat_id, bat_nm, acad)
      ON CONFLICT (student_id, batch_id) DO NOTHING;
    END IF;

    INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
    VALUES ('FB3-'||lpad(i::TEXT,4,'0')||'-1', sid, sname, fee_v, m1, p1d, p1s, modes[1], 'monthly', acad);
    INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
    VALUES ('FB3-'||lpad(i::TEXT,4,'0')||'-2', sid, sname, fee_v, m2, p2d, p2s, modes[2], 'monthly', acad);
    INSERT INTO payments (id,student_id,student,amount,month,date,status,mode,payment_type,academy_id)
    VALUES ('FB3-'||lpad(i::TEXT,4,'0')||'-3', sid, sname, fee_v, m3, p3d, p3s, modes[3], 'monthly', acad);
  END LOOP;

  UPDATE batches SET enrolled = (SELECT COUNT(*) FROM students s WHERE s.batch_id = batches.id)
  WHERE academy_id = acad AND code LIKE 'FB3-%';

  RAISE NOTICE '6 batches · 6 staff · 200 students · 600 payments seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 5. STUDENT ATTENDANCE — last 21 days, only on each batch's training days
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
SELECT d::DATE, s.id, s.batch_id, s.st <> 'Absent', s.st, b.coach
FROM generate_series(CURRENT_DATE - 20, CURRENT_DATE, '1 day'::INTERVAL) d
CROSS JOIN LATERAL (
  SELECT s.id, s.batch_id,
    CASE WHEN random() < 0.80 THEN 'Present'
         WHEN random() < 0.50 THEN 'Late'
         ELSE 'Absent' END AS st
  FROM students s
  WHERE s.student_code ~ '^FB3\d{4}$' AND s.status = 'Active'
) s
JOIN batches b ON b.id = s.batch_id
WHERE to_char(d, 'Dy') = ANY(b.days)
ON CONFLICT DO NOTHING;

-- Backfill academy_id / branch_id on attendance if those columns exist
DO $$
DECLARE acad UUID; br UUID;
BEGIN
  SELECT id, academy_id INTO br, acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='academy_id') THEN
    EXECUTE 'UPDATE attendance SET academy_id = $1 WHERE academy_id IS NULL AND student_id IN
             (SELECT id FROM students WHERE student_code ~ ''^FB3\d{4}$'')' USING acad;
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='branch_id') THEN
    EXECUTE 'UPDATE attendance SET branch_id = $1 WHERE branch_id IS NULL AND student_id IN
             (SELECT id FROM students WHERE student_code ~ ''^FB3\d{4}$'')' USING br;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 6. COACH ATTENDANCE — staff_checkins, last 21 days
-- ══════════════════════════════════════════════════════════════════════════
-- Clock-in ~5-25 min before the morning session, clock-out after evening.
-- Today's rows are left open (no clock_out) for two coaches so the dashboard
-- clock-in widget has something live to show.
DO $$
DECLARE acad UUID;
BEGIN
  IF to_regclass('public.staff_checkins') IS NULL THEN
    RAISE NOTICE 'staff_checkins table missing — skipped'; RETURN;
  END IF;

  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO staff_checkins (staff_id, academy_id, date, clock_in, clock_out)
  SELECT st.id, acad, d::DATE,
         d::DATE + TIME '05:40' + (random() * INTERVAL '25 minutes'),
         CASE WHEN d::DATE = CURRENT_DATE AND st.phone IN ('9700003101','9700003102')
              THEN NULL
              ELSE d::DATE + TIME '19:30' + (random() * INTERVAL '40 minutes') END
  FROM generate_series(CURRENT_DATE - 20, CURRENT_DATE, '1 day'::INTERVAL) d
  CROSS JOIN staff st
  WHERE st.phone LIKE '97000031%'
    AND to_char(d, 'Dy') <> 'Sun'                     -- Sunday off
    AND NOT (st.phone = '9700003104' AND to_char(d,'Dy') = 'Sat')  -- GK coach off Sat
    AND random() < 0.93                               -- occasional absence
  ON CONFLICT (staff_id, date) DO NOTHING;

  RAISE NOTICE 'Coach attendance seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 7. LEAVE REQUESTS — 3 Pending (dashboard card) + 3 decided
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE acad UUID;
BEGIN
  IF to_regclass('public.leave_requests') IS NULL THEN RETURN; END IF;
  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO leave_requests (staff_id, staff_name, start_date, end_date, reason, status, academy_id)
  SELECT st.id, st.name, v.sd, v.ed, v.reason, v.status, acad
  FROM staff st
  JOIN (VALUES
    ('9700003102', CURRENT_DATE + 3,  CURRENT_DATE + 5,  'Family wedding out of town',        'Pending'),
    ('9700003103', CURRENT_DATE + 8,  CURRENT_DATE + 9,  'Coaching licence renewal exam',     'Pending'),
    ('9700003105', CURRENT_DATE + 1,  CURRENT_DATE + 1,  'Medical appointment',               'Pending'),
    ('9700003104', CURRENT_DATE - 12, CURRENT_DATE - 10, 'Personal work',                     'Approved'),
    ('9700003106', CURRENT_DATE - 20, CURRENT_DATE - 19, 'Festival leave',                    'Approved'),
    ('9700003103', CURRENT_DATE - 5,  CURRENT_DATE - 2,  'Requested during tournament week',  'Rejected')
  ) AS v(phone, sd, ed, reason, status) ON v.phone = st.phone;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 8. SKILL ASSESSMENTS — 3 months × 200 students, real football skill set
-- ══════════════════════════════════════════════════════════════════════════
-- scores JSONB is keyed by the exact skill names in src/lib/performance.js
-- (FOOTBALL_CATEGORIES), so the assessment report and radar charts render.
-- Scores trend upward month over month so progress graphs look real.
DO $$
DECLARE
  acad UUID;
  skill_list TEXT[] := ARRAY[
    'Controlling','Handling Air Ball','Handling Low Ball','Passing','Reaction',
    'Shooting','Heading','Distribution (GK)',
    'Attacking Tactics','Defending Tactics','Game Intelligence','Anticipation',
    'Roles & Responsibility','Positioning',
    'Speed','Coordination','Explosive Strength','Reflex','Flexibility',
    'Concentration','Communication','Leadership','Discipline','Attitude',
    'Creativity','Courage','Relationship','Confidence'];
  note_pool TEXT[] := ARRAY[
    'Strong week on the ball. Needs to scan more before receiving.',
    'Excellent attitude in training. Work on weaker foot finishing.',
    'Reading of the game improving. Push for more vocal leadership.',
    'Big improvement in first touch under pressure.',
    'Fitness levels up. Positioning in transition still inconsistent.',
    'Very coachable. Ready to step up to the next age group soon.'];
BEGIN
  IF to_regclass('public.skill_assessments') IS NULL THEN
    RAISE NOTICE 'skill_assessments missing — skipped'; RETURN;
  END IF;
  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO skill_assessments (student_id, staff_id, batch_id, sport, assessed_month, scores, notes, academy_id)
  SELECT s.id,
         (SELECT id FROM staff WHERE phone = CASE
            WHEN b.code IN ('FB3-U08','FB3-U10') THEN '9700003103'
            WHEN b.code IN ('FB3-U12','FB3-U14') THEN '9700003102'
            WHEN b.code = 'FB3-GRL'              THEN '9700003105'
            ELSE '9700003101' END LIMIT 1),
         s.batch_id, 'Football',
         TO_CHAR(CURRENT_DATE - (mo || ' months')::INTERVAL, 'YYYY-MM'),
         (SELECT jsonb_object_agg(sk, LEAST(98, GREATEST(25,
             base - mo * 4 + (random() * 22)::INT - 11)))
          FROM unnest(skill_list) sk),
         note_pool[(1 + ((s.id + mo) % 6))::INT],
         acad
  FROM students s
  JOIN batches b ON b.id = s.batch_id
  CROSS JOIN generate_series(0, 2) mo
  CROSS JOIN LATERAL (SELECT 48 + (s.id % 34) AS base) g
  WHERE s.student_code ~ '^FB3\d{4}$'
  ON CONFLICT (student_id, assessed_month, sport) DO NOTHING;

  RAISE NOTICE 'Skill assessments seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 9. SESSION FEEDBACK — coach pulse on the last 6 training dates + spotlights
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE acad UUID;
BEGIN
  IF to_regclass('public.session_feedback') IS NULL THEN RETURN; END IF;
  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO session_feedback (
    academy_id, batch_id, student_id, staff_id, date,
    effort, execution, focus,
    technical, tactical, physical, mental, note, spotlight_at)
  SELECT acad, s.batch_id, s.id,
         (SELECT id FROM staff WHERE phone='9700003102' LIMIT 1),
         d::DATE,
         1 + (random()*2)::INT, 1 + (random()*2)::INT, 1 + (random()*2)::INT,
         CASE WHEN spot THEN 1 + (random()*2)::INT END,
         CASE WHEN spot THEN 1 + (random()*2)::INT END,
         CASE WHEN spot THEN 1 + (random()*2)::INT END,
         CASE WHEN spot THEN 1 + (random()*2)::INT END,
         CASE WHEN spot THEN (ARRAY[
           'Outstanding pressing today — set the tone for the group.',
           'Best passing session so far. Kept the tempo high.',
           'Led the warm-up without being asked. Real leadership.',
           'Beat his marker repeatedly in the 1v1 block.'])[1+(random()*3)::INT] END,
         CASE WHEN spot THEN d::DATE + TIME '19:00' END
  FROM (
    SELECT DISTINCT a.date AS d FROM attendance a
    JOIN students s2 ON s2.id = a.student_id
    WHERE s2.student_code ~ '^FB3\d{4}$'
    ORDER BY 1 DESC LIMIT 6
  ) dates
  CROSS JOIN LATERAL (
    SELECT s.id, s.batch_id, (random() < 0.12) AS spot
    FROM students s
    WHERE s.student_code ~ '^FB3\d{4}$' AND s.status = 'Active'
  ) s
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Session feedback seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 10. PLAYER GOALS — one focus goal per student per month, last 3 months
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  acad UUID;
  goal_pool TEXT[] := ARRAY[
    'Complete 80% of passes with the weaker foot in small-sided games',
    'Win 5 aerial duels per session',
    'Cut first-touch errors in the final third by half',
    'Track back on every turnover — no walking',
    'Take 50 extra shots a week after training',
    'Call the line and organise the back four every session',
    'Beat the first defender at least twice per game',
    'Hold shape as the deepest midfielder for a full 20-minute block'];
BEGIN
  IF to_regclass('public.player_goals') IS NULL THEN RETURN; END IF;
  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO player_goals (academy_id, student_id, staff_id, month, goal_text)
  SELECT acad, s.id,
         (SELECT id FROM staff WHERE phone='9700003101' LIMIT 1),
         TO_CHAR(CURRENT_DATE - (mo || ' months')::INTERVAL, 'YYYY-MM'),
         goal_pool[(1 + ((s.id + mo) % 8))::INT]
  FROM students s
  CROSS JOIN generate_series(0, 2) mo
  WHERE s.student_code ~ '^FB3\d{4}$'
  ON CONFLICT (student_id, month) DO NOTHING;

  RAISE NOTICE 'Player goals seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 11. TRIALS — 30 leads across the whole pipeline
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE acad UUID; br UUID; b_u12 BIGINT;
BEGIN
  SELECT id, academy_id INTO br, acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;
  SELECT id INTO b_u12 FROM batches WHERE academy_id=acad AND code='FB3-U12' LIMIT 1;

  INSERT INTO trials (
    name, parent, phone, sport, trial_date, source, status, converted, follow_up,
    age, batch_id, stage, trial_sessions, sessions_done, coach_note, coach_rec,
    notes, quoted_fee, academy_id, branch_id)
  SELECT
    (ARRAY['Aryan','Kabir','Rehan','Ved','Ishan','Nirvaan','Advik','Reyaan','Zayn','Arnav'])[1+(i%10)]
      || ' ' || (ARRAY['Malhotra','Bhatia','Sethi','Kohli','Ahuja','Chopra','Bedi','Dhillon'])[1+(i%8)],
    (ARRAY['Rohit','Manish','Farhan','Gaurav','Ajay','Pankaj','Nitin','Harpreet'])[1+(i%8)]
      || ' ' || (ARRAY['Malhotra','Bhatia','Sethi','Kohli','Ahuja','Chopra','Bedi','Dhillon'])[1+(i%8)],
    '9' || lpad((700320000+i)::TEXT, 9, '0'),
    'Football',
    CURRENT_DATE - 25 + i,
    (ARRAY['Instagram','Walk-in','Referral','Google','School Camp','WhatsApp'])[1+(i%6)],
    CASE WHEN i <= 12 THEN 'Completed' WHEN i <= 26 THEN 'Scheduled' ELSE 'Cancelled' END,
    (i <= 8),
    CASE WHEN i BETWEEN 9 AND 20 THEN CURRENT_DATE - 2 + (i % 4) END,
    8 + (i % 8),
    b_u12,
    CASE WHEN i <= 8 THEN 'converted' WHEN i <= 12 THEN 'trial_done'
         WHEN i <= 20 THEN 'scheduled' ELSE 'new' END,
    2,
    CASE WHEN i <= 12 THEN 2 WHEN i <= 20 THEN 1 ELSE 0 END,
    CASE WHEN i <= 12 THEN (ARRAY[
      'Good first touch, needs work on pace. Fits U12 group.',
      'Very raw but great attitude — worth taking.',
      'Strong physically, tactically behind the group.',
      'Natural finisher. Recommend Elite pathway.'])[1+(i%4)] END,
    CASE WHEN i <= 8 THEN 'accept' WHEN i <= 12 THEN 'followup' ELSE NULL END,
    CASE WHEN i % 3 = 0 THEN 'Parent asked about sibling discount' END,
    (ARRAY[2000,2200,2500,3200])[1+(i%4)],
    acad, br
  FROM generate_series(1, 30) i;

  RAISE NOTICE '30 trials seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 12. ANNOUNCEMENTS — branch-scoped community posts
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE acad UUID; br UUID;
BEGIN
  SELECT id, academy_id INTO br, acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO announcements (title, body, type, author, date, sport, branch_id, academy_id)
  VALUES
    ('Branch 3 is now open!','Our third Football centre is live. U8 to U16 batches plus a dedicated Girls Squad. Turf 1, Turf 2 and the Main Ground are all in use from this week.','Announcement','Vikas Bhardwaj',CURRENT_DATE - 14,'Football',br,acad),
    ('Inter-Branch Tournament — Sunday','Branch 1 vs Branch 2 vs Branch 3 at the Main Ground, 8 AM. U12 and U14 squads have been announced by the coaches. Parents welcome.','Tournament','Vikas Bhardwaj',CURRENT_DATE - 6,'Football',br,acad),
    ('New goalkeeping sessions','Sandeep Chauhan now runs a dedicated GK block every Tuesday and Thursday, 17:00-18:00. Speak to your coach to be added.','Announcement','Anjali Verma',CURRENT_DATE - 4,'Football',br,acad),
    ('Monthly fees — reminder','July fees are due. You can pay by UPI, cash at the centre, or the payment link sent on WhatsApp. Please clear dues to avoid a break in training.','Notice','Anjali Verma',CURRENT_DATE - 2,'Football',br,acad),
    ('Monsoon schedule','If a session is called off for rain, you will get a WhatsApp within 45 minutes of the start time. Missed sessions will be added to the following week.','Notice','Vikas Bhardwaj',CURRENT_DATE,'Football',br,acad);

  RAISE NOTICE '5 announcements seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 13. WEEKLY SCHEDULES — current + next week for every batch (if migrated)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE acad UUID;
BEGIN
  IF to_regclass('public.weekly_schedules') IS NULL THEN
    RAISE NOTICE 'weekly_schedules missing (migration 0106 not applied) — skipped'; RETURN;
  END IF;
  SELECT academy_id INTO acad FROM sport_branches
  WHERE sport_name='Football' AND branch_name='Branch 3' LIMIT 1;

  INSERT INTO weekly_schedules (academy_id, batch_id, coach_id, coach_name, team_name, week_start, grid)
  SELECT acad, b.id, st.id, b.coach, b.name,
         (date_trunc('week', CURRENT_DATE) + (wk || ' weeks')::INTERVAL)::DATE,
         jsonb_build_object(
           'Mon', jsonb_build_array('Warm-up + rondos','Passing patterns','Small-sided game'),
           'Tue', jsonb_build_array('Speed & agility','1v1 attacking','Finishing'),
           'Wed', jsonb_build_array('Possession grid','Shape work','Match play'),
           'Thu', jsonb_build_array('Strength circuit','Set pieces','Small-sided game'),
           'Fri', jsonb_build_array('Technical circuit','Crossing & finishing','Match play'),
           'Sat', jsonb_build_array('Match day'),
           'Sun', jsonb_build_array('Rest'))
  FROM batches b
  LEFT JOIN staff st ON st.name = b.coach AND st.academy_id = acad
  CROSS JOIN generate_series(0, 1) wk
  WHERE b.academy_id = acad AND b.code LIKE 'FB3-%'
  ON CONFLICT (batch_id, week_start) DO NOTHING;

  RAISE NOTICE 'Weekly schedules seeded';
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 14. VERIFY — read the numbers back
-- ══════════════════════════════════════════════════════════════════════════
SELECT b.name AS batch, b.days, b.coach, COUNT(s.id) AS students
FROM batches b
LEFT JOIN students s ON s.batch_id = b.id AND s.student_code ~ '^FB3\d{4}$'
WHERE b.code LIKE 'FB3-%'
GROUP BY b.name, b.days, b.coach
ORDER BY b.name;

SELECT 'students'          AS what, status, COUNT(*) AS n FROM students  WHERE student_code ~ '^FB3\d{4}$' GROUP BY status
UNION ALL
SELECT 'payments',                  status, COUNT(*)      FROM payments  WHERE id LIKE 'FB3-%'             GROUP BY status
UNION ALL
SELECT 'trials',                    status, COUNT(*)      FROM trials    WHERE branch_id = (SELECT id FROM sport_branches WHERE sport_name='Football' AND branch_name='Branch 3') GROUP BY status
ORDER BY what, status;

-- Row counts for every optional module, skipping any table this DB doesn't have
DO $$
DECLARE t TEXT; n BIGINT; sql TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance','skill_assessments','session_feedback','player_goals','student_batches'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '%: table not present', t; CONTINUE;
    END IF;
    sql := format('SELECT COUNT(*) FROM %I WHERE student_id IN
                   (SELECT id FROM students WHERE student_code ~ ''^FB3\d{4}$'')', t);
    EXECUTE sql INTO n;
    RAISE NOTICE '%: % rows', t, n;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['staff_checkins','leave_requests'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '%: table not present', t; CONTINUE;
    END IF;
    sql := format('SELECT COUNT(*) FROM %I WHERE staff_id IN
                   (SELECT id FROM staff WHERE phone LIKE ''97000031%%'')', t);
    EXECUTE sql INTO n;
    RAISE NOTICE '%: % rows', t, n;
  END LOOP;
END $$;
