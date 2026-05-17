# 0016 — Sport Catalog + Branch Model · Test Plan

## Order of operations
1. Run `0016a_sport_catalog_dryrun.sql` — read-only, shows current state
2. Review output (see expected results below)
3. Run `0016b_sport_catalog.sql` — applies the additive migration
4. Run the post-migration verification queries at the bottom of `0016b`
5. (Only if anything is wrong) run `0016_rollback.sql`

> Frontend changes (Phase 3) are **not yet deployed**. Until they are, the app continues to use `academy_branches` as the sport list — running the migration alone does not change any user-facing behavior.

---

## Dryrun — expected output

| Query | What you should see | Why |
|---|---|---|
| 1 | Current sport names per academy | Sanity check — these are what shows on `/sport-select` today |
| 2 | `in_catalog = true` for catalog names | Catalog names will be backfilled into `academy_sports` |
| 2 | `in_catalog = false` for free-text like "Football_ARA_branch 2" | Those stay in `academy_branches` (backward compat) |
| 3 | Sport values used by actual students | If any non-catalog sport has many students, owner needs to decide later whether to remap |
| 4 | 0 rows | Confirms `branch_id` / `branch_sport` columns don't exist yet |
| 5 | 0 rows | Confirms `academy_sports` and `sport_branches` tables don't exist yet |
| 7 | Existing roles (coach/admin/etc.) | New role `branch_manager` will be a frontend constant only |

---

## Apply — collision checks (built into 0016b)

| Risk | Guard in 0016b |
|---|---|
| Duplicate table names | `CREATE TABLE IF NOT EXISTS` |
| Duplicate columns | `ADD COLUMN IF NOT EXISTS` |
| Duplicate primary keys | UNIQUE constraints + `ON CONFLICT DO NOTHING` on backfill |
| Duplicate index | `CREATE INDEX IF NOT EXISTS` |
| Duplicate RLS policy | `DROP POLICY IF EXISTS` before `CREATE POLICY` |
| Partial commit on error | `BEGIN`/`COMMIT` wrapper — full rollback if any step fails |

---

## Functional tests (after migration, before frontend changes)

### Backward-compat (must still work — touch nothing)
| # | Action | Expected |
|---|---|---|
| B1 | Owner logs in, opens `/sport-select` | Same sport cards as before (from `academy_branches`) |
| B2 | Owner picks a sport → `/dashboard` | Same students/batches/payments visible as before |
| B3 | Owner adds a new student | Works exactly as before (sport field unchanged) |
| B4 | Owner records a payment | Calculation unchanged, `paid_till` advances correctly |
| B5 | Coach marks attendance | Attendance row created, no duplicates |
| B6 | Existing student with non-catalog sport ("Football_ARA_branch 2") | Still appears under "All Sports" + its existing sport card |
| B7 | RLS — staff/coach login | Sees own academy data only |

### New tables (smoke tests — direct DB)
| # | Action | Expected |
|---|---|---|
| N1 | `INSERT INTO academy_sports (academy_id, sport_name) VALUES (..., 'Football')` | Succeeds (or no-op on second run) |
| N2 | Insert duplicate sport for same academy | Fails on UNIQUE — no duplicate created |
| N3 | `INSERT INTO sport_branches` for an existing sport | Succeeds |
| N4 | RLS check — query `academy_sports` as authenticated user | Returns only own academy's rows |

### Frontend tests (will be done after Phase 3 deploy, NOT yet)
| # | Action | Expected |
|---|---|---|
| F1 | Owner opens "Add Sport" on `/sport-select` | Dropdown of catalog values (no free-text input) |
| F2 | Owner picks a catalog sport not yet present | Row appears in `academy_sports`; card appears on `/sport-select` |
| F3 | Owner opens sport card → "Manage Branches" panel | Can add/remove rows in `sport_branches` |
| F4 | Owner adds new student | Sport dropdown shows configured sports |
| F5 | Branch manager logs in | Sees only their `branch_sport` students; cannot see other sports |
| F6 | Branch manager cannot toggle "All Sports" | UI restricts to their assigned sport |
| F7 | Owner switches academies | Sees their own sports — RLS isolation works |

---

## Rollback test

If anything breaks after applying 0016b:

```sql
\i supabase/migrations/0016_rollback.sql
```

Then verify:
- `academy_sports` and `sport_branches` are gone (`\dt` in psql, or query `information_schema`)
- `profiles.branch_id`, `profiles.branch_sport` are gone
- `user_permissions.branch_id`, `user_permissions.branch_sport` are gone
- `academy_branches` is **still intact** with all its rows
- App continues to work using legacy `academy_branches` for the sport list

---

## Safety summary

| Concern | Status |
|---|---|
| Payment calculations | Untouched |
| Attendance calculations | Untouched |
| Student record fields | Untouched |
| `academy_branches` (legacy) | Untouched |
| Owner auth flow | Untouched |
| Staff auth flow | Untouched (new role is frontend-only constant) |
| Existing RLS on legacy tables | Untouched |
| Cross-tenant data leakage | Mirrors existing `get_my_academy_id()` pattern |
