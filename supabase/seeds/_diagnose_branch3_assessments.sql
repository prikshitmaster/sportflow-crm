-- ══════════════════════════════════════════════════════════════════════════
-- DIAGNOSTIC — why does Branch 3 show "Not assessed" for everyone?
-- ══════════════════════════════════════════════════════════════════════════
-- Read-only. Run the whole file in the Supabase SQL Editor and read the
-- results top to bottom — each query rules out one cause.
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Do assessments exist at all per Football branch, and for which months?
--    If Branch 3 is missing here, section 8 of football_branch3_full_demo.sql
--    never ran (or was rolled back) — re-run football_performance_seed.sql.
SELECT sb.branch_name,
       a.assessed_month,
       COUNT(*)                        AS rows,
       COUNT(DISTINCT a.student_id)    AS students
FROM skill_assessments a
JOIN students s        ON s.id = a.student_id
JOIN sport_branches sb ON sb.id = s.branch_id
WHERE sb.sport_name = 'Football'
GROUP BY sb.branch_name, a.assessed_month
ORDER BY sb.branch_name, a.assessed_month DESC;


-- 2. What month does the app consider "current"? The page matches
--    assessed_month EXACTLY against this string. A mismatch here (e.g. rows
--    written for the wrong month, or a timezone rollover) means zero matches.
SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM') AS app_current_month,
       CURRENT_DATE                     AS db_today;


-- 3. academy_id agreement. The page filters by the owner's academy; a NULL or
--    mismatched academy_id on the assessment makes it invisible.
SELECT sb.branch_name,
       COUNT(*)                                                          AS total,
       COUNT(*) FILTER (WHERE a.academy_id IS NULL)                      AS null_academy,
       COUNT(*) FILTER (WHERE a.academy_id IS DISTINCT FROM s.academy_id) AS mismatched_academy
FROM skill_assessments a
JOIN students s        ON s.id = a.student_id
JOIN sport_branches sb ON sb.id = s.branch_id
WHERE sb.sport_name = 'Football'
GROUP BY sb.branch_name
ORDER BY sb.branch_name;


-- 4. sport value on the rows. The page picks the row whose sport matches the
--    student's sport — a case or spelling difference breaks the match.
SELECT sb.branch_name, a.sport AS assessment_sport, s.sport AS student_sport, COUNT(*)
FROM skill_assessments a
JOIN students s        ON s.id = a.student_id
JOIN sport_branches sb ON sb.id = s.branch_id
WHERE sb.sport_name = 'Football'
GROUP BY sb.branch_name, a.sport, s.sport
ORDER BY sb.branch_name;


-- 5. Status split. The page lists ACTIVE students only, so assessments that
--    belong exclusively to Suspended students will never be shown.
SELECT sb.branch_name, s.status,
       COUNT(DISTINCT s.id)                                              AS students,
       COUNT(DISTINCT s.id) FILTER (WHERE a.id IS NOT NULL)              AS with_assessment_this_month
FROM students s
JOIN sport_branches sb ON sb.id = s.branch_id
LEFT JOIN skill_assessments a
       ON a.student_id = s.id
      AND a.assessed_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
WHERE sb.sport_name = 'Football'
GROUP BY sb.branch_name, s.status
ORDER BY sb.branch_name, s.status;


-- 6. Row-cap check. If this exceeds your project's API "Max rows" setting
--    (Supabase → Settings → API, default 1000), an academy-wide query would
--    silently truncate and could drop an entire branch.
SELECT COUNT(*) AS assessments_this_month_academy_wide
FROM skill_assessments
WHERE assessed_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM');


-- 7. Sample 5 raw Branch 3 rows — confirms scores actually contain the 28
--    skill keys rather than an empty or malformed object.
SELECT a.student_id, s.name, a.assessed_month, a.sport,
       jsonb_typeof(a.scores)              AS scores_type,
       (SELECT COUNT(*) FROM jsonb_object_keys(a.scores)) AS skill_count,
       (SELECT COUNT(*) FROM jsonb_each_text(a.scores) v(k, val)
         WHERE val::numeric > 0)           AS rated_above_zero
FROM skill_assessments a
JOIN students s        ON s.id = a.student_id
JOIN sport_branches sb ON sb.id = s.branch_id
WHERE sb.sport_name = 'Football' AND sb.branch_name = 'Branch 3'
ORDER BY a.assessed_month DESC, a.student_id
LIMIT 5;
