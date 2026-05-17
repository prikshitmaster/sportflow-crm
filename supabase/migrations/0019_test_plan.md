# 0019 — Phase A1 RLS Hardening · Test Plan

## What this migration does (and doesn't)

**Does:**
- Scopes all authenticated RLS to `academy_id` (closes C1 — cross-tenant authenticated leak)
- Adds a BEFORE UPDATE trigger blocking `profiles.role` changes by non-owners (closes C5)
- Locks `user_permissions` INSERT / UPDATE / DELETE to owner only (closes C6)
- Tightens `audit_logs` — no UPDATE / DELETE allowed by anyone; INSERT / SELECT scoped to academy

**Does NOT (Phase A2 or later):**
- Anon read on `students` / `payments` / `attendance` — still wide open (student portal needs these until refactored)
- `student_sessions` policy — still wide open (need session-token-based RPC)
- Anon insert on `attendance` and `staff_attendance` — still wide open (gate QR uses these)
- Branch-level RLS using `branch_id` — Phase B

---

## Order of operations

1. **Run `0019a_rls_hardening_dryrun.sql`** — read-only preview
2. Review output:
   - Query 1 shows current policies (helps spot if 0003 was already applied)
   - Query 2 confirms `get_my_academy_id()` helper exists
   - Query 3 shows existing triggers on profiles (should be none from prior migration)
   - Query 4 row counts — capture these numbers
3. **Run `0019b_rls_hardening.sql`** — applies hardening
4. Run verification queries at bottom of `0019b`
5. **Run all functional tests below**
6. If anything is broken: `0019_rollback.sql`

---

## Functional tests (must all pass after 0019b)

### Owner portal (the most-used path — must not regress)

| # | Action | Expected |
|---|---|---|
| O1 | Log in as owner → `/sport-select` | Sport cards visible as before |
| O2 | Pick a sport → `/dashboard` | Dashboard loads with current data |
| O3 | `/students` | All 102 students visible |
| O4 | Add a new student | Inserts successfully |
| O5 | Edit a student | Save works |
| O6 | Delete a student | Delete works |
| O7 | Record a payment | Insert works |
| O8 | `/payments` list | Shows all payments |
| O9 | Mark attendance from `/attendance` | Insert/update works |
| O10 | `/reports` → Audit Log | All historical audit entries visible |
| O11 | `/settings` → Fee plans | Read + add + edit + delete |
| O12 | Invite a staff user from `/coaches` | Insert into `staff_invites` works |
| O13 | Create a sport branch | Insert into `sport_branches` works |

### Staff portal (should still work for the current 1 admin staff + 1 coach)

| # | Action | Expected |
|---|---|---|
| S1 | Coach login | Staff dashboard loads |
| S2 | `/staff/attendance` | Coach can mark their batch |
| S3 | `/staff/students` (admin role) | Sees all academy students |
| S4 | Admin tries `/staff/payments` | Visible (has perm) |

### Security tests (should now FAIL — these are the fixes)

| # | Attack | Method | Expected |
|---|---|---|---|
| A1 | Cross-academy read | Log in as Academy A user → query students with no academy filter | Returns ONLY Academy A's rows |
| A2 | Cross-academy write | Direct API: `UPDATE students SET status='X' WHERE academy_id='other-uuid'` | Affects 0 rows |
| A3 | Self-role escalation | `UPDATE profiles SET role='owner' WHERE id=auth.uid()` as non-owner | ERROR: insufficient_privilege |
| A4 | Staff edits own permissions | `UPDATE user_permissions SET access_role='admin' WHERE user_id=auth.uid()` as coach | ERROR / 0 rows |
| A5 | Tamper audit log | `DELETE FROM audit_logs WHERE id=1` as anyone | ERROR / 0 rows |
| A6 | Tamper audit log via UPDATE | `UPDATE audit_logs SET note='changed' WHERE id=1` | ERROR / 0 rows |

### NOT-fixed-yet tests (Phase A2 work)

| # | Attack | Expected (still works = bug not yet fixed) |
|---|---|---|
| P1 | Anon read all students | `curl https://...supabase.co/rest/v1/students?select=* -H "apikey: $ANON"` | ✅ still leaks |
| P2 | Anon insert attendance | direct INSERT via anon | ✅ still allowed |
| P3 | Forge student session | INSERT into student_sessions for any student_id | ✅ still possible |

These three are intentionally untouched in Phase A1 because:
- Fixing them requires app code changes in `db.js` (move to RPCs)
- The student portal would break if these get locked without the app change
- Will be addressed in Phase A2

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| App stops loading after migration (RLS denied) | Low — the app already queries with academy_id filter | Run rollback (one SQL file) |
| Owner can't see their own data | Very low — same as O1–O13 tests | Verify their `profiles.academy_id` is correct |
| Staff portal breaks because of user_permissions read | Low — read policy stays academy-wide | If broken, rollback |
| audit_logs INSERT fails | Low — app always sets academy_id in audit entries | Confirm `logAudit()` includes academyId |
| Role escalation trigger blocks legitimate owner action | Low — owners are detected via `academies.owner_id = auth.uid()` | If owner can't promote staff, the bug is in profiles.academy_id; investigate |

---

## Rollback

```sql
\i supabase/migrations/0019_rollback.sql
```

This restores every policy to its pre-migration `USING (true)` state and drops the trigger. The app continues working but the security holes return.

---

## Sign-off checklist

- [ ] Dryrun output captured (Query 1–5)
- [ ] 0019b ran without error in Supabase SQL Editor
- [ ] Row counts match dryrun Query 4 (no row data changed)
- [ ] All Owner tests O1–O13 pass
- [ ] All Staff tests S1–S4 pass
- [ ] Security tests A1–A6 all blocked as expected
- [ ] Phase A2 ticket created (anon hardening + RPC migration)
