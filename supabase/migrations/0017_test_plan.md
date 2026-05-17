# 0017 — Full Branch Isolation · Test Plan

## Order of operations
1. Run `0017a_branch_isolation_dryrun.sql` — read-only preview
2. **Important**: capture Query 3 output (the list of "Football _ARA _ branch 2" student IDs) — this is your manual rollback safety net
3. Run `0017b_branch_isolation.sql` — applies migration + backfill
4. Run verification queries at the bottom of `0017b`
5. (Only if needed) run `0017_rollback.sql`

> Frontend changes (Phase 3 — pickers, AppContext filtering, branch manager auth) are **not in this migration**. After 0017b, all existing code paths still work because `branch_id` is nullable.

---

## Dryrun — what each query tells you

| Query | Purpose |
|---|---|
| 1 | Where sport values currently live (students/batches/staff/trials) |
| 2 | Catalog match + target branch for each distinct sport value |
| 3 | List of student IDs that will move to Branch 2 — **CAPTURE THIS** |
| 4 | Confirms branch_id columns don't already exist |
| 5 | Confirms 0016b tables (sport_branches) exist — prerequisite |
| 6 | Current sport_branches rows (should be 0 before backfill) |
| 7 | Volume summary — how many records will be touched |

---

## Backfill rules (encoded in 0017b)

| Source | Branch assignment |
|---|---|
| Student with sport='Football' (or any catalog sport) | Branch 1 of that sport |
| Student with sport LIKE 'football%branch%2%' | Branch 2 of Football; sport renamed to 'Football' |
| Student with non-catalog sport (rare) | branch_id stays NULL — won't migrate. Owner can assign manually later |
| Batch with sports[0]='Football' | Branch 1 of Football |
| Staff with sports[0]='Football' | Branch 1 of Football |
| Trial with sport='Football' | Branch 1 of Football |
| Audit log on a student | Inherits student.branch_id |

---

## Functional tests (after 0017b, before frontend)

### Backward-compat (must not break)
| # | Action | Expected |
|---|---|---|
| B1 | Open `/sport-select` | Same cards as before (driven by legacy `academy_branches` until Phase 3 frontend) |
| B2 | Open `/dashboard` with selectedSport='Football' | All 47 Football students visible |
| B3 | Open `/students` | All 71 students visible across All Sports view |
| B4 | Record a payment | Calculation unchanged, paid_till advances correctly |
| B5 | Mark attendance | Single row per (date, student_id) — no duplicates |
| B6 | Open Reports → Audit Log | All historical events visible |
| B7 | Coach login | No regression |

### Data integrity (direct DB queries)
| # | Check | Expected |
|---|---|---|
| D1 | `SELECT COUNT(*) FROM students WHERE branch_id IS NULL` | 0 (or only non-catalog sports) |
| D2 | `SELECT COUNT(*) FROM sport_branches WHERE branch_name='Branch 1'` | 1 per distinct catalog sport in students |
| D3 | `SELECT COUNT(*) FROM sport_branches WHERE branch_name='Branch 2'` | 1 if you had "Football _ARA _ branch 2", else 0 |
| D4 | `SELECT sport, COUNT(*) FROM students GROUP BY sport` | No more 'Football _ARA _ branch 2'; counts match pre-migration totals |
| D5 | `SELECT COUNT(*) FROM batches WHERE branch_id IS NULL` | 0 (assuming all batches had sports[]) |
| D6 | `SELECT branch_name, COUNT(*) FROM students s JOIN sport_branches sb ON s.branch_id=sb.id GROUP BY 1` | Branch 1: 69 (or 71−legacy-count); Branch 2: 2 |

### Smoke tests on new columns
| # | Action | Expected |
|---|---|---|
| N1 | `INSERT INTO sport_branches (academy_id, sport_name, branch_name) VALUES (...)` | Succeeds |
| N2 | Insert duplicate (same academy + sport + branch_name) | Fails on UNIQUE — correct |
| N3 | `UPDATE students SET branch_id=NULL WHERE id=X; UPDATE students SET branch_id=Y WHERE id=X;` | Reassignment works |

### Frontend tests (Phase 3 — NOT YET)
*Will be tested after frontend changes deploy:*
- Owner picks Football → sees Branch 1 + Branch 2 cards
- Owner clicks Branch 1 → only sees Branch 1 students
- Branch manager login → scoped to single branch
- Add Student form → branch dropdown after sport
- Add Batch → branch picker

---

## Rollback test

```sql
\i supabase/migrations/0017_rollback.sql
```

Verify after rollback:
- `branch_id` columns gone from students/batches/staff/trials/audit_logs
- "Branch 1" / "Branch 2" rows removed from `sport_branches`
- Students whose sport was renamed Football _ARA _ branch 2 → Football STAY as 'Football' (would need backup to restore the original string — see Step 3 of dryrun)

---

## Safety summary

| Concern | Status |
|---|---|
| Payment calculations | Untouched |
| Attendance calculations | Untouched |
| Student record IDs | Untouched (PKs unchanged) |
| Existing FKs | Untouched (we only ADD a new optional column) |
| Owner auth flow | Untouched |
| Staff auth flow | Untouched |
| Cross-tenant RLS | Untouched (new column lives within existing academy_id scope) |
| Backward compat | All existing code still works — branch_id is nullable and never read by current code |
