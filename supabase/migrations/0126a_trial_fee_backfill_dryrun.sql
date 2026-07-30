-- ============================================================
-- 0126a — Trial fee backfill DRY RUN (READ ONLY)
-- ============================================================
-- WRITES NOTHING. Run this, read the numbers, and only then decide
-- whether to run 0126b.
--
-- ⚠️  THE THING YOU MUST CHECK
--   trials.trial_fee_paid DEFAULTS to 590 on every row ever created
--   (0012_trial_slip_fields.sql:6). There was never a "did they actually
--   pay?" flag — 0124 only just added trial_fee_mode, and ADD COLUMN
--   ... DEFAULT 'Cash' backfilled EVERY existing row to 'Cash'.
--
--   So a phone enquiry that never showed up is currently indistinguishable
--   from a paid trial. Section 1 below tells you how much money that is.
--   Compare TOTAL_REVENUE_DELTA against the number of trial receipts your
--   academy actually issued. If it is too high, mark the enquiry-only
--   trials as 'Not collected' BEFORE running 0126b:
--
--     UPDATE trials SET trial_fee_mode = 'Not collected'
--      WHERE id IN (...);            -- or some predicate you trust
--
-- Run each section separately — the Supabase SQL editor shows one result
-- set at a time.
-- ============================================================


-- ── SECTION 1: the headline numbers ──────────────────────────
-- Run this first. TOTAL_REVENUE_DELTA is what your reported revenue
-- will increase by.
WITH candidates AS (
  SELECT t.*
  FROM trials t
  WHERE COALESCE(t.trial_fee_paid, 0) > 0
    AND COALESCE(t.trial_fee_mode, 'Cash') <> 'Not collected'
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id)
)
SELECT '1. ROWS_TO_INSERT'          AS metric, COUNT(*)::TEXT                      AS value FROM candidates
UNION ALL
SELECT '2. TOTAL_REVENUE_DELTA',    '₹' || COALESCE(SUM(trial_fee_paid),0)::TEXT   FROM candidates
UNION ALL
SELECT '3. ...of which CONVERTED',  '₹' || COALESCE(SUM(trial_fee_paid) FILTER (WHERE converted),0)::TEXT     FROM candidates
UNION ALL
SELECT '4. ...of which NEVER converted (enquiry risk)',
                                    '₹' || COALESCE(SUM(trial_fee_paid) FILTER (WHERE NOT converted),0)::TEXT FROM candidates
UNION ALL
SELECT '5. ROWS_WITH_NULL_BRANCH (will be hidden in branch views)',
                                    COUNT(*) FILTER (WHERE branch_id IS NULL)::TEXT FROM candidates
UNION ALL
SELECT '6. ROWS_WITH_NULL_SPORT (will be hidden in sport views)',
                                    COUNT(*) FILTER (WHERE sport IS NULL OR sport = '')::TEXT FROM candidates
UNION ALL
SELECT '7. ROWS_WITH_NULL_TRIAL_DATE (will fall back to created_at)',
                                    COUNT(*) FILTER (WHERE trial_date IS NULL)::TEXT FROM candidates
UNION ALL
SELECT '8. FUTURE_DATED (books into a future month)',
                                    COUNT(*) FILTER (WHERE trial_date > CURRENT_DATE)::TEXT FROM candidates
ORDER BY metric;


-- ── SECTION 2: delta per month ───────────────────────────────
-- Which past months' reported revenue will change, and by how much.
SELECT to_char(COALESCE(t.trial_date, t.created_at::DATE), 'YYYY-MM') AS month,
       COUNT(*)                                                       AS trials,
       '₹' || SUM(t.trial_fee_paid)::TEXT                             AS delta
FROM trials t
WHERE COALESCE(t.trial_fee_paid, 0) > 0
  AND COALESCE(t.trial_fee_mode, 'Cash') <> 'Not collected'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id)
GROUP BY 1
ORDER BY 1 DESC;


-- ── SECTION 3: delta per branch ──────────────────────────────
SELECT COALESCE(b.sport_name || ' · ' || b.branch_name,
                '⚠️  NO BRANCH — will be hidden in branch views') AS branch,
       COUNT(*)                            AS trials,
       '₹' || SUM(t.trial_fee_paid)::TEXT  AS delta
FROM trials t
LEFT JOIN sport_branches b ON b.id = t.branch_id
WHERE COALESCE(t.trial_fee_paid, 0) > 0
  AND COALESCE(t.trial_fee_mode, 'Cash') <> 'Not collected'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id)
GROUP BY 1
ORDER BY 2 DESC;


-- ── SECTION 4: student-link quality for CONVERTED trials ─────
-- 0126b links a trial to its student only when EXACTLY ONE student
-- matches on academy + normalised phone + name. Everything else is left
-- unlinked (student_id NULL) — revenue is still correct, only the
-- per-student attribution is missing.
WITH candidates AS (
  SELECT t.*
  FROM trials t
  WHERE COALESCE(t.trial_fee_paid, 0) > 0
    AND COALESCE(t.trial_fee_mode, 'Cash') <> 'Not collected'
    AND t.converted
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id)
),
matched AS (
  SELECT c.id,
         (SELECT COUNT(*) FROM students s
           WHERE s.academy_id = c.academy_id
             AND regexp_replace(COALESCE(s.phone,''), '\D', '', 'g')
               = regexp_replace(COALESCE(c.phone,''), '\D', '', 'g')
             AND lower(btrim(s.name)) = lower(btrim(c.name))
             AND s.join_date >= c.trial_date - INTERVAL '1 day'
         ) AS n
  FROM candidates c
)
SELECT CASE n WHEN 1 THEN 'linked (exactly 1 match)'
              WHEN 0 THEN 'UNLINKED — no matching student'
              ELSE        'UNLINKED — ambiguous, ' || n || ' matches' END AS outcome,
       COUNT(*) AS trials
FROM matched
GROUP BY 1
ORDER BY 2 DESC;


-- ── SECTION 5: the unrecoverable residual ────────────────────
-- Students whose first payment carries a 'Trial fee deducted' note but
-- whose trial row no longer exists (deleted, or entered manually). Their
-- ₹X was netted off the first month and there is nothing left to book it
-- against — no backfill can recover this. Reported so you know the gap.
--
-- NOTE the '−' in the note is U+2212 MINUS SIGN, not an ASCII hyphen
-- (AppContext.jsx:938), hence the [^₹]* wildcard rather than a literal.
SELECT p.id                AS payment_id,
       p.student           AS student_name,
       p.date              AS paid_on,
       substring(p.notes FROM 'Trial fee deducted[^₹]*₹([0-9,]+)') AS unbooked_amount
FROM payments p
JOIN students s ON s.id = p.student_id
WHERE p.notes ~ 'Trial fee deducted'
  AND NOT EXISTS (
    SELECT 1 FROM trials t
     WHERE t.academy_id = s.academy_id
       AND regexp_replace(COALESCE(t.phone,''), '\D', '', 'g')
         = regexp_replace(COALESCE(s.phone,''), '\D', '', 'g')
       AND lower(btrim(t.name)) = lower(btrim(s.name))
  )
ORDER BY p.date DESC;


-- ── SECTION 6: the golden number ─────────────────────────────
-- Record this BEFORE running 0126b. Afterwards the difference must equal
-- TOTAL_REVENUE_DELTA from section 1 exactly. Any other number means a
-- double-book or a miss.
SELECT '₹' || COALESCE(SUM(amount), 0)::TEXT AS paid_revenue_before_backfill
FROM payments WHERE status = 'Paid';
