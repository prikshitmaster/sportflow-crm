# Phase 0 — Completion Record

**Date completed:** 2026-05-20
**Branch:** main
**Status:** ✅ All 4 tasks done, migration applied to production, all tests green
**Commit:** NOT YET COMMITTED — code changes are on disk only

---

## What Phase 0 fixed

Five critical race conditions and data leaks before scaling beyond a single academy. All fixes are in `src/lib/db.js` plus one SQL migration.

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Attendance duplicate rows (null-batch path used wrong onConflict key) | `src/lib/db.js:889 saveAttendanceMonth` | ✅ Fixed |
| 2 | Leave request cross-academy data leak (`academy_id IS NULL` OR clause) | `src/lib/db.js:1762 fetchLeaveRequests` | ✅ Fixed |
| 4 | Invoice/student-code race (legacy client-side max-scan fallbacks) | `src/lib/db.js:926, 953` | ✅ Fixed |
| 5 | Batch enrolled race (SELECT-then-UPDATE fallback) | `src/lib/db.js:318 updateBatchEnrolled` | ✅ Fixed |
| — | SQL migration with partial unique index, gate_qr.academy_id col, atomic RPC, backfills, indexes | `supabase/migrations/0031_phase0_hardening.sql` | ✅ Applied to prod |

Task 3 (gate QR academy_id) was deferred to Phase 1 because the migration adds the column but the JS callers in AdminQR.jsx / StaffAttendanceQR.jsx / StudentScan.jsx still need updating.

---

## Files changed (uncommitted)

```
src/lib/db.js                                          (4 edits)
supabase/migrations/0031_phase0_hardening.sql          (new)
PHASE0_COMPLETE.md                                     (this file)
```

Plus pre-existing uncommitted from before Phase 0:
```
.claude/settings.local.json
project-memory.md
```
(Earlier work was committed as v1.0 checkpoint: `5e78899` and prior.)

---

## Migration 0031 — what it did

Already executed in Supabase prod via SQL Editor. **Do not re-run unless rebuilding from scratch** — the backfills are idempotent but the function drop+create will recreate the function.

1. `CREATE UNIQUE INDEX att_no_batch_idx ON attendance(date, student_id) WHERE batch_id IS NULL`
   — partial unique index that lets PostgreSQL treat the null-batch onConflict key correctly.
2. `ALTER TABLE gate_qr ADD COLUMN academy_id uuid REFERENCES academies(id)`
   — column added but **not yet populated** and **not yet used** by JS (deferred to Phase 1 Task 3).
3. `DROP FUNCTION + CREATE FUNCTION bump_batch_enrolled(BIGINT, INT) RETURNS VOID`
   — old function from migration 0014 had a non-void return type which blocked `CREATE OR REPLACE`. Now returns void.
4. `UPDATE leave_requests SET academy_id = staff.academy_id WHERE academy_id IS NULL`
   — backfilled all legacy NULL rows. Verified: 0 NULL rows remaining.
5. `UPDATE students SET branch_id = sport_branches.id WHERE single-branch sport match`
   — auto-assigned branch_id where unambiguous. Safe — only ran when exactly one matching branch existed.
6. Three new indexes: `idx_students_academy_sport_branch`, `idx_students_academy_branch`, `idx_payments_academy_student`.

---

## Test results (all passed)

| Test | Result |
|------|--------|
| `SELECT date,student_id,batch_id,COUNT(*) FROM attendance GROUP BY 1,2,3 HAVING COUNT(*)>1` | 0 rows ✅ |
| `SELECT bump_batch_enrolled(21, 1); SELECT bump_batch_enrolled(21, 1)` then check enrolled | 5 → 7, then reset to 5 ✅ |
| `SELECT COUNT(*) FROM leave_requests WHERE academy_id IS NULL` | 0 ✅ |
| `SELECT next_student_code()` | Returned `SA148` ✅ |
| `SELECT next_invoice_id()` | Returned `INV-2026-144` ✅ |

---

## Important context for next session

### What's safe to deploy
The JS changes in `src/lib/db.js` are safe to deploy **now** because:
- Migration 0031 is already live in production
- All RPCs the JS now requires (`next_student_code`, `next_invoice_id`, `bump_batch_enrolled`) are confirmed working
- The partial unique index needed by the attendance onConflict fix is live

### What changed in the JS API surface (zero breaking changes for callers)
- `fetchNextStudentCode()` — same signature, same return shape (`SA###`). Just no longer has the racy fallback.
- `fetchNextInvoiceId()` — same signature, same return shape (`INV-YYYY-###`).
- `fetchNextInvoiceNum()` — **DELETED**. Verified no JS callers (only doc references in markdown files).
- `updateBatchEnrolled(batchId, delta)` — same signature. Now throws clearly if RPC is missing instead of silently racing.
- `saveAttendanceMonth(...)` — same signature. Internal upsert now uses the same conflict key for both null-batch and with-batch rows.
- `fetchLeaveRequests(academyId)` — same signature. Strict academy filter (no more NULL leak).

### What's NOT yet done from Phase 0 scope
- Task 3 (gate_qr.academy_id JS wiring) — column added in SQL but `getOrCreateGateQR`, `regenerateGateQR`, `validateGateToken` still don't filter by academy. Callers in `AdminQR.jsx`, `StaffAttendanceQR.jsx`, `StudentScan.jsx` not updated. **Will be picked up in Phase 1.**

---

## Phase 1 — what's next

Per the master refactor doc, Phase 1 = "Stabilize Multi-Branch" + the deferred Task 3 from Phase 0.

### Phase 1 task list

| Task | File | What |
|------|------|------|
| 3 | `src/lib/db.js` + 3 page callers | Add academy_id filter to gate_qr (column already in DB from 0031) |
| 6 | `src/context/AppContext.jsx:~1523 sportBatches useMemo` | Replace length-sorted primary-sport heuristic with `sports.includes(selectedSport)` |
| 7 | `src/context/AppContext.jsx:~371 visibilitychange handler` | Throttle full reloadAll() to once per 5 min on tab focus |
| 8 | `src/pages/SportSelect.jsx` + `AppContext.jsx` | Read sportList from sportBranches (new system) instead of branches[] (old academy_branches text table) |

### Phase 1 prompt for new session

> "Pick up Phase 1 from PHASE0_COMPLETE.md. Start with Task 3 (gate_qr.academy_id JS wiring). Do not commit, do not push. Show me the diff for db.js first, then each caller file one at a time. Migration 0031 already added the academy_id column to gate_qr in production."

### Phase 1 caveats
- **Task 7 throttling** — when this lands, owners who expect "tab focus = fresh data" will see stale data for up to 5 min. There is a manual refresh button (`refreshData()`) — verify it's exposed in the UI before shipping. Add a comment if not.
- **Task 8 dual branch system** — `branches[]` (text array from `academy_branches` table) and `sportBranches[]` (uuid objects from `sport_branches` table) coexist. Settings.jsx may still read from `branches[]`. Keep both for now; just change SportSelect's sportList computation to derive from `sportBranches`. Don't remove `addBranch`/`removeBranch` from AppContext exports.
- **Task 3 (gate_qr)** — `regenerateGateQR` currently uses `.neq('id', 0)` which deletes ALL rows across all academies. Fix to `.eq('academy_id', academyId)` is critical. Verify all three callers (AdminQR, StaffAttendanceQR, StudentScan) pass academyId/studentUser.academy_id.

---

## Rollback plan (if something breaks in prod)

### JS rollback
```bash
git checkout src/lib/db.js
```
This reverts to the v1.0 checkpoint state. The DB changes from migration 0031 are backward-compatible — old JS still works against the new schema (the partial index, new column, and RPC are all additive).

### SQL rollback (only if absolutely needed — none of these changes are destructive)
```sql
-- 1. Drop the partial index (forces old onConflict behavior — harmless)
DROP INDEX IF EXISTS att_no_batch_idx;

-- 2. Drop the gate_qr column (no JS callers use it yet, safe)
ALTER TABLE gate_qr DROP COLUMN IF EXISTS academy_id;

-- 3. Restore bump_batch_enrolled to its old signature
--    (only needed if your old JS expected a non-void return type — check migration 0014)
DROP FUNCTION bump_batch_enrolled(BIGINT, INT);
-- then paste 0014's original definition

-- 4. The leave_requests / students / new indexes are pure data hygiene — leave them.
```

---

## Master refactor priority (from main doc)

```
✅ Phase 0 (DONE) — Today's safe fixes
   ✅ Task 1, 2, 4, 5
   ⏭️  Task 3 deferred to Phase 1

⏳ Phase 1 (NEXT) — Stabilize multi-branch
   ☐ Task 3 — gate_qr JS wiring
   ☐ Task 6 — sport batch filter
   ☐ Task 7 — visibility throttle
   ☐ Task 8 — deprecate legacy academy_branches

⏳ Phase 2 — Real RLS (server-side token validation)
   ☐ Drop USING(true) policies
   ☐ Add owner/staff/student JWT-scoped policies

⏳ Phase 3 — Paginate & scale
   ☐ Task 9 — paginated fetchStudents
   ☐ Task 10 — split AppContext into Auth/Scope/Data
```

---

## When ready to commit

User has NOT yet asked to commit. When they do, suggested message:

```
fix(db): phase 0 hardening — atomic counters, dup-row guards, leave isolation

- saveAttendanceMonth: unify onConflict key, requires att_no_batch_idx partial index
- fetchLeaveRequests: drop NULL-academy_id OR clause; backfill via migration
- fetchNextStudentCode / fetchNextInvoiceId: remove race-prone client-side fallbacks
- updateBatchEnrolled: remove SELECT-then-UPDATE fallback, RPC-only
- migration 0031: partial index, gate_qr.academy_id col, atomic counter,
  legacy backfills, scaling indexes
```
