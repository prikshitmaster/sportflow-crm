-- ══════════════════════════════════════════════════════════════════════════
-- FOOTBALL PERFORMANCE — FULL HISTORY FIXTURE (Branch 2 + Branch 3)
-- ══════════════════════════════════════════════════════════════════════════
-- Gives every ACTIVE student in Football / Branch 2 and Branch 3 a complete
-- performance record:
--
--   • SKILL ASSESSMENTS — one for EVERY month from the month they joined the
--     academy through the current month (capped at 24 months back so the
--     oldest joiners don't generate hundreds of rows). Scores climb steadily
--     month over month, so the trend line and month-over-month deltas tell a
--     real improvement story.
--   • DEVELOPMENT PLANS — a goal for every one of those months, so whichever
--     month you pick in the dropdown has a plan attached. Focus skills on the
--     recent months where 0117 is applied.
--   • SESSION PULSE — every training day for the last 90 days (Mon/Wed/Fri +
--     Tue/Thu/Sat patterns are covered by seeding every other day), with
--     spotlights sprinkled through.
--
-- THE TWO BRANCHES ARE DELIBERATELY DIFFERENT so a cross-branch leak is
-- obvious at a glance:
--            score band     goal wording     expected average
--   Branch 2  higher         set A            ~68
--   Branch 3  ~10 lower      set B            ~58
--   Switching branches on /performance must change the AVERAGE SCORE tile, the
--   student list and the goal text. A set-A goal showing under Branch 3 = leak.
--
-- COVERAGE NOTE
--   Unlike the earlier draft, this seeds EVERY active student — no deliberate
--   "not assessed" gaps — because a full board is what you want to demo. The
--   natural edge cases still occur on their own: students who joined this month
--   have exactly one assessment (no previous month → delta "—", radar with no
--   ghost overlay), and Distribution (GK) stays 0 for outfielders, which
--   exercises the "0 means not rated" rule.
--
-- SCORES use the exact 28 skill display names from src/lib/performance.js
-- (FOOTBALL_CATEGORIES) — scores JSONB is keyed by display name, so a typo
-- there silently empties the radar.
--
-- HOW TO RUN
--   Supabase → SQL Editor → paste this entire file → Run.
--   Expect 30-90 s: this writes a few thousand rows.
--   Safe to re-run — every insert is ON CONFLICT DO UPDATE on its natural key,
--   so a second run refreshes rather than duplicates. NOTHING IS DELETED.
--
-- SAFETY
--   Only Active students in the two named branches, resolved at runtime.
--   Branch 1 is untouched. A branch that doesn't exist is skipped, not an error.
--
-- REQUIRES 0117 (focus_skills) and 0118 (updated_by_role) — both optional, the
-- seed detects them and skips those columns if absent.
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- 0. PRE-FLIGHT — what we're about to write
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  bname TEXT; br UUID; n_act INT; n_months BIGINT; found INT := 0;
BEGIN
  FOREACH bname IN ARRAY ARRAY['Branch 2','Branch 3'] LOOP
    SELECT id INTO br FROM sport_branches
     WHERE sport_name = 'Football' AND branch_name = bname LIMIT 1;

    IF br IS NULL THEN
      RAISE NOTICE '% : NOT FOUND — skipping', bname; CONTINUE;
    END IF;

    SELECT COUNT(*) INTO n_act
      FROM students WHERE branch_id = br AND status = 'Active';

    -- Total month-rows we're about to create for this branch.
    SELECT COALESCE(SUM(
             (DATE_PART('year',  CURRENT_DATE) - DATE_PART('year',  gs.start_m)) * 12
           + (DATE_PART('month', CURRENT_DATE) - DATE_PART('month', gs.start_m)) + 1), 0)
      INTO n_months
      FROM students s
      CROSS JOIN LATERAL (
        SELECT GREATEST(
                 date_trunc('month', COALESCE(s.join_date, CURRENT_DATE)),
                 date_trunc('month', CURRENT_DATE - INTERVAL '24 months')) AS start_m
      ) gs
     WHERE s.branch_id = br AND s.status = 'Active';

    RAISE NOTICE '% : % active students → ~% assessment rows', bname, n_act, n_months;
    found := found + 1;
  END LOOP;

  IF found = 0 THEN
    RAISE EXCEPTION 'Neither Branch 2 nor Branch 3 exists. Football branches present: %',
      COALESCE((SELECT string_agg(branch_name, ', ') FROM sport_branches
                 WHERE sport_name = 'Football'), '(none)');
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. SKILL ASSESSMENTS — every month since joining
-- ══════════════════════════════════════════════════════════════════════════
-- Set-based rather than nested loops: a few thousand rows in one statement per
-- branch instead of one round trip per row.
DO $$
DECLARE
  bname TEXT; b_idx INT := 0; b_off INT;
  br UUID; acad UUID; v_staff BIGINT; n_rows INT;
  has_catnotes BOOL;

  -- Exact display names from FOOTBALL_CATEGORIES (src/lib/performance.js).
  skills TEXT[] := ARRAY[
    'Controlling','Handling Air Ball','Handling Low Ball','Passing','Reaction',
    'Shooting','Heading','Distribution (GK)',
    'Attacking Tactics','Defending Tactics','Game Intelligence','Anticipation',
    'Roles & Responsibility','Positioning',
    'Speed','Coordination','Explosive Strength','Reflex','Flexibility',
    'Concentration','Communication','Leadership','Discipline','Attitude',
    'Creativity','Courage','Relationship','Confidence'];

  tech_notes TEXT[] := ARRAY[
    'First touch has settled. Still rushes the release under pressure.',
    'Striking through the ball much better than last month.',
    'Weak foot is the clear next step — everything else is ahead of the group.'];
  tact_notes TEXT[] := ARRAY[
    'Scans before receiving now. Positioning in transition still late.',
    'Reads the second ball well. Needs to talk the line up.',
    'Understands the press trigger; occasionally goes alone.'];
  ath_notes TEXT[] := ARRAY[
    'Top-end speed is a strength. Change of direction needs work.',
    'Noticeably fitter across the full session.',
    'Strong in contact for the age group.'];
  ment_notes TEXT[] := ARRAY[
    'Excellent attitude, first to every drill.',
    'Leads the warm-up unprompted. Confidence dips after a mistake.',
    'Very coachable — applies feedback the same session.'];
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                 WHERE table_name='skill_assessments' AND column_name='category_notes')
    INTO has_catnotes;

  -- The INSERT below always names category_notes, so fail loudly and early
  -- rather than dying halfway through with a confusing "column does not exist".
  IF NOT has_catnotes THEN
    RAISE EXCEPTION 'skill_assessments.category_notes is missing — apply migration 0063_assessment_pdf_fields.sql first';
  END IF;

  FOREACH bname IN ARRAY ARRAY['Branch 2','Branch 3'] LOOP
    b_off := CASE b_idx WHEN 0 THEN 0 ELSE -10 END;
    b_idx := b_idx + 1;

    SELECT id, academy_id INTO br, acad FROM sport_branches
     WHERE sport_name = 'Football' AND branch_name = bname LIMIT 1;
    CONTINUE WHEN br IS NULL;

    -- A coach from THIS branch, so staff_id never points at another branch.
    SELECT id INTO v_staff FROM staff
     WHERE branch_id = br AND status = 'Active' ORDER BY id LIMIT 1;

    INSERT INTO skill_assessments (
      student_id, staff_id, batch_id, sport, assessed_month, scores, notes,
      academy_id, category_notes)
    SELECT
      s.id, v_staff, s.batch_id, COALESCE(s.sport, 'Football'),
      TO_CHAR(m.mon, 'YYYY-MM'),
      (SELECT jsonb_object_agg(
                t.sk,
                CASE
                  -- Distribution (GK) only matters for keepers. 0 for
                  -- outfielders is realistic AND exercises "0 = not rated".
                  WHEN t.sk = 'Distribution (GK)' AND (s.id % 11) <> 0 THEN 0
                  ELSE GREATEST(15, LEAST(99,
                       -- ceiling for this player, minus decay going back in
                       -- time, plus a stable per-skill wobble
                       (CASE (s.id % 4) WHEN 0 THEN 88 WHEN 1 THEN 74
                                        WHEN 2 THEN 60 ELSE 46 END) + b_off
                       - (mi.months_ago * 2)
                       + ((s.id * 7 + t.ord * 13) % 17) - 8))
                END)
         FROM unnest(skills) WITH ORDINALITY AS t(sk, ord)),
      'Monthly review.',
      acad,
      jsonb_build_object(
        'technical',   tech_notes[(1 + ((s.id + mi.months_ago) % 3))::INT],
        'tactical',    tact_notes[(1 + ((s.id + mi.months_ago) % 3))::INT],
        'athleticism', ath_notes [(1 + ((s.id + mi.months_ago) % 3))::INT],
        'personality', ment_notes[(1 + ((s.id + mi.months_ago) % 3))::INT])
    FROM students s
    CROSS JOIN LATERAL generate_series(
      GREATEST(date_trunc('month', COALESCE(s.join_date, CURRENT_DATE)),
               date_trunc('month', CURRENT_DATE - INTERVAL '24 months')),
      date_trunc('month', CURRENT_DATE),
      INTERVAL '1 month') AS m(mon)
    CROSS JOIN LATERAL (
      SELECT ((DATE_PART('year',  CURRENT_DATE) - DATE_PART('year',  m.mon)) * 12
            + (DATE_PART('month', CURRENT_DATE) - DATE_PART('month', m.mon)))::INT
             AS months_ago
    ) mi
    WHERE s.branch_id = br AND s.status = 'Active'
    ON CONFLICT (student_id, assessed_month, sport) DO UPDATE SET
      scores         = EXCLUDED.scores,
      notes          = EXCLUDED.notes,
      staff_id       = EXCLUDED.staff_id,
      batch_id       = EXCLUDED.batch_id,
      category_notes = EXCLUDED.category_notes;

    GET DIAGNOSTICS n_rows = ROW_COUNT;
    RAISE NOTICE '% : % assessment rows', bname, n_rows;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. DEVELOPMENT PLANS — a goal for every assessed month
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  bname TEXT; b_idx INT := 0; br UUID; acad UUID; v_staff BIGINT; n_rows INT;
  has_focus BOOL; has_role BOOL;
  goal_set TEXT[];

  goals_a TEXT[] := ARRAY[      -- Branch 2
    'Complete 80% of passes with the weaker foot in small-sided games',
    'Win 5 aerial duels per session',
    'Cut first-touch errors in the final third by half',
    'Track back on every turnover — no walking',
    'Beat the first defender at least twice per game',
    'Hold shape as the deepest midfielder for a full 20-minute block'];

  goals_b TEXT[] := ARRAY[      -- Branch 3, worded differently on purpose
    'Two-touch limit in every rondo this month',
    'Call the offside line out loud on every restart',
    'Finish 20 shots per session with the standing foot planted',
    'Sprint back into shape within 6 seconds of losing the ball',
    'Receive on the half-turn instead of playing backwards',
    'Win the first duel in every attacking third entry'];
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                 WHERE table_name='player_goals' AND column_name='focus_skills') INTO has_focus;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                 WHERE table_name='player_goals' AND column_name='updated_by_role') INTO has_role;

  IF NOT has_focus THEN
    RAISE NOTICE 'player_goals.focus_skills missing (apply 0117) — goals seeded without focus skills';
  END IF;

  FOREACH bname IN ARRAY ARRAY['Branch 2','Branch 3'] LOOP
    goal_set := CASE b_idx WHEN 0 THEN goals_a ELSE goals_b END;
    b_idx    := b_idx + 1;

    SELECT id, academy_id INTO br, acad FROM sport_branches
     WHERE sport_name = 'Football' AND branch_name = bname LIMIT 1;
    CONTINUE WHEN br IS NULL;

    SELECT id INTO v_staff FROM staff
     WHERE branch_id = br AND status = 'Active' ORDER BY id LIMIT 1;

    -- One goal per month the student has an assessment for.
    INSERT INTO player_goals (student_id, month, goal_text, staff_id, academy_id)
    SELECT a.student_id,
           a.assessed_month,
           goal_set[(1 + ((a.student_id + LENGTH(a.assessed_month)) % 6))::INT],
           v_staff, acad
      FROM skill_assessments a
      JOIN students s ON s.id = a.student_id
     WHERE s.branch_id = br AND s.status = 'Active'
    ON CONFLICT (student_id, month) DO UPDATE SET
      goal_text = EXCLUDED.goal_text,
      staff_id  = EXCLUDED.staff_id;

    GET DIAGNOSTICS n_rows = ROW_COUNT;
    RAISE NOTICE '% : % development plans', bname, n_rows;

    -- Focus skills on the last 3 months only — that is where the owner will be
    -- looking, and it keeps older months as goal-only (still a valid state).
    IF has_focus THEN
      EXECUTE $q$
        UPDATE player_goals g
           SET focus_skills = (
                 '[["Heading","Positioning","Explosive Strength"],
                   ["Passing","Game Intelligence","Communication"],
                   ["Shooting","Anticipation","Speed"],
                   ["Controlling","Defending Tactics","Concentration"]]'::jsonb
                 -> ((g.student_id % 4)::INT))
          FROM students s
         WHERE s.id = g.student_id
           AND s.branch_id = $1
           AND s.status = 'Active'
           AND g.month >= TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM')
      $q$ USING br;
    END IF;

    IF has_role THEN
      EXECUTE $q$
        UPDATE player_goals g SET updated_by_role = 'staff'
          FROM students s
         WHERE s.id = g.student_id AND s.branch_id = $1 AND s.status = 'Active'
      $q$ USING br;
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. SESSION PULSE — every other day for the last 90 days, + spotlights
-- ══════════════════════════════════════════════════════════════════════════
-- Every other day covers both the Mon/Wed/Fri and Tue/Thu/Sat batch patterns
-- without writing a row for every student every single day.
DO $$
DECLARE
  bname TEXT; br UUID; acad UUID; v_staff BIGINT; n_rows INT;
  spot_notes TEXT[] := ARRAY[
    'Outstanding pressing today — set the tone for the whole group.',
    'Best passing session so far, kept the tempo high throughout.',
    'Organised the back line without being asked. Real leadership.',
    'Beat his marker repeatedly in the 1v1 block.'];
BEGIN
  IF to_regclass('public.session_feedback') IS NULL THEN
    RAISE NOTICE 'session_feedback missing — skipped'; RETURN;
  END IF;

  FOREACH bname IN ARRAY ARRAY['Branch 2','Branch 3'] LOOP
    SELECT id, academy_id INTO br, acad FROM sport_branches
     WHERE sport_name = 'Football' AND branch_name = bname LIMIT 1;
    CONTINUE WHEN br IS NULL;

    SELECT id INTO v_staff FROM staff
     WHERE branch_id = br AND status = 'Active' ORDER BY id LIMIT 1;

    INSERT INTO session_feedback (
      academy_id, batch_id, student_id, staff_id, date,
      effort, execution, focus,
      technical, tactical, physical, mental, note, spotlight_at)
    SELECT
      acad, x.batch_id, x.id, v_staff, x.d,
      1 + ((x.id + x.n)     % 3),
      1 + ((x.id + x.n * 2) % 3),
      1 + ((x.id + x.n * 3) % 3),
      CASE WHEN x.spot THEN 1 + ((x.id + 1) % 3) END,
      CASE WHEN x.spot THEN 1 + ((x.id + 2) % 3) END,
      CASE WHEN x.spot THEN 1 + ((x.id + 3) % 3) END,
      CASE WHEN x.spot THEN 1 + ((x.id + 4) % 3) END,
      CASE WHEN x.spot THEN spot_notes[(1 + (x.id % 4))::INT] END,
      CASE WHEN x.spot THEN x.d + TIME '19:00' END
    FROM (
      SELECT s.id, s.batch_id, g.n,
             (CURRENT_DATE - (g.n * 2))::DATE AS d,
             ((s.id + g.n) % 7 = 0)           AS spot
        FROM students s
        CROSS JOIN generate_series(0, 44) AS g(n)     -- 45 × 2 days ≈ 90 days
       WHERE s.branch_id = br AND s.status = 'Active'
         AND EXTRACT(DOW FROM (CURRENT_DATE - (g.n * 2))) <> 0   -- skip Sundays
    ) x
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS n_rows = ROW_COUNT;
    RAISE NOTICE '% : % pulse rows', bname, n_rows;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 4. VERIFY — this is exactly what /performance should show
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  sb.branch_name                                   AS branch,
  COUNT(DISTINCT s.id)                             AS active_students,
  COUNT(DISTINCT a.student_id)                     AS assessed_this_month,
  COUNT(DISTINCT g.student_id)                     AS plans_this_month,
  ROUND(AVG(x.avg_score))                          AS avg_score_this_month
FROM sport_branches sb
JOIN students s ON s.branch_id = sb.id AND s.status = 'Active'
LEFT JOIN skill_assessments a
       ON a.student_id = s.id AND a.assessed_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
LEFT JOIN player_goals g
       ON g.student_id = s.id AND g.month = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
LEFT JOIN LATERAL (
  SELECT AVG(v.val::numeric) FILTER (WHERE v.val::numeric > 0) AS avg_score
    FROM jsonb_each_text(COALESCE(a.scores, '{}'::jsonb)) AS v(k, val)
) x ON TRUE
WHERE sb.sport_name = 'Football' AND sb.branch_name IN ('Branch 2','Branch 3')
GROUP BY sb.branch_name
ORDER BY sb.branch_name;

-- History depth — how many months each branch now covers.
SELECT sb.branch_name,
       MIN(a.assessed_month) AS earliest,
       MAX(a.assessed_month) AS latest,
       COUNT(DISTINCT a.assessed_month) AS distinct_months,
       COUNT(*) AS total_rows
FROM skill_assessments a
JOIN students s ON s.id = a.student_id
JOIN sport_branches sb ON sb.id = s.branch_id
WHERE sb.sport_name = 'Football' AND sb.branch_name IN ('Branch 2','Branch 3')
GROUP BY sb.branch_name ORDER BY sb.branch_name;

-- ISOLATION CHECK — must return ZERO rows.
SELECT a.id, a.student_id, a.academy_id AS assessment_academy, s.academy_id AS student_academy
FROM skill_assessments a JOIN students s ON s.id = a.student_id
WHERE a.academy_id IS DISTINCT FROM s.academy_id;


-- ══════════════════════════════════════════════════════════════════════════
-- REMOVING THIS FIXTURE (uncomment only if you want it gone)
-- ══════════════════════════════════════════════════════════════════════════
-- DO $$
-- DECLARE sids BIGINT[];
-- BEGIN
--   SELECT ARRAY(SELECT s.id FROM students s
--                  JOIN sport_branches sb ON sb.id = s.branch_id
--                 WHERE sb.sport_name = 'Football'
--                   AND sb.branch_name IN ('Branch 2','Branch 3')) INTO sids;
--   DELETE FROM skill_assessments WHERE student_id = ANY(sids);
--   DELETE FROM session_feedback  WHERE student_id = ANY(sids);
--   DELETE FROM player_goals      WHERE student_id = ANY(sids);
--   RAISE NOTICE 'Fixture removed for % students', array_length(sids, 1);
-- END $$;
