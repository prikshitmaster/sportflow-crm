# Phase 1 — Completion Record

**Date completed:** 2026-05-20
**Branch:** main
**Status:** ✅ All 4 tasks done. **Not yet tested in browser. Not committed.**

---

## What Phase 1 fixed

Stabilizes multi-branch + the deferred Task 3 gate QR scoping from Phase 0.

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 3 | gate_qr academy_id scoping (JS wiring) | `src/lib/db.js`, `AdminQR.jsx`, `staff/StaffDashboard.jsx`, `student/StudentScan.jsx` | ✅ |
| 6 | Sport batch filter — drop length-sort heuristic | `src/context/AppContext.jsx`, `src/pages/Batches.jsx` | ✅ |
| 7 | visibilitychange throttle (5 min) | `src/context/AppContext.jsx` | ✅ |
| 8 | SportSelect sportList from sport_branches | `src/pages/SportSelect.jsx` | ✅ |

---

## Files changed (uncommitted)

```
src/lib/db.js                          (Task 3: gate_qr signatures)
src/pages/AdminQR.jsx                  (Task 3: pass academyId)
src/pages/staff/StaffDashboard.jsx     (Task 3: pass academyId)
src/pages/student/StudentScan.jsx      (Task 3: pass academy_id)
src/context/AppContext.jsx             (Task 6: sportBatches filter, Task 7: throttle + useRef import)
src/pages/Batches.jsx                  (Task 6: getBatchSection rewrite)
src/pages/SportSelect.jsx              (Task 8: sportList derives from sportBranches)
PHASE1_COMPLETE.md                     (this file)
```

Pre-existing uncommitted (carried from before):
```
.claude/settings.local.json
project-memory.md
```

---

## Function signature changes (breaking — callers updated)

### gate_qr functions in db.js

```js
// BEFORE
getOrCreateGateQR(academyName)
regenerateGateQR(academyName)
validateGateToken(token)
markAttendanceViaQR(studentId, gateToken, batchIdOverride)

// AFTER
getOrCreateGateQR(academyId, academyName)        // throws if no academyId
regenerateGateQR(academyId, academyName)         // throws if no academyId
validateGateToken(token, academyId)              // returns false if no academyId
markAttendanceViaQR(studentId, gateToken, batchIdOverride, academyId)
```

All 3 known callers updated:
- `AdminQR.jsx:21,35` → passes `user?.academyId`
- `StaffDashboard.jsx:38` → passes `user?.academyId`
- `StudentScan.jsx:266` → passes `studentUser.academy_id`

**Side note on `regenerateGateQR`:** previously used `.neq('id', 0)` which deleted **every academy's** gate QR — now restricted to `.eq('academy_id', academyId)`. This was a real cross-tenant data loss bug.

---

## Behavior changes worth knowing

### Task 6 (sport batch filter)
- A batch with `sports: ["Cricket", "Football"]` now appears under BOTH sports when filtered, instead of only the longer-name one. This is the intended behavior.
- `getBatchSection` in Batches.jsx now picks `selectedSport` if the batch belongs to it, else first sport in the array. No more "Cricket Advanced" header on a "Cricket" view.

### Task 7 (visibility throttle)
- After this change, switching to another tab and coming back within 5 minutes does NOT trigger a `loadAll()`. Saves 6MB on every quick tab switch.
- **If owner expects fresh data after returning**, they can hit any refresh button. The throttle does not affect manual refreshes, login, or initial mount.
- The 5-min window is from `lastRefreshRef.current` (initialized to `Date.now()` on mount), so the first visibility event within 5 min of opening the app is also skipped — acceptable since data was just loaded.

### Task 8 (SportSelect sportList)
- Primary source is now `sportBranches` (the new uuid-based table).
- Fallbacks: legacy `branches[]` (text array from `academy_branches`), then sports inferred from `allStudents`.
- Existing academies without `sport_branches` rows will keep working via fallback. New academies should populate `sport_branches` (which the "Add Sport" flow already does via the branch picker).

---

## Testing checklist (not yet done)

Per Phase 0 pattern — verify before committing.

### Task 3 — Gate QR scoping
1. Log in as owner → AdminQR → confirm gate QR loads (will be a fresh one because old NULL-academy_id rows don't match)
2. SQL check: `SELECT academy_id, COUNT(*) FROM gate_qr GROUP BY academy_id` — should show rows with non-null academy_id matching your academy
3. Log in as student → StudentScan → scan owner's QR → attendance marks correctly
4. **Cross-tenant test:** If you have two academies, scan Academy A's QR while logged in as Academy B's student. Should fail with "Invalid gate QR code".

### Task 6 — Sport batch filter
1. Find a batch with multiple sports (e.g. `sports: ["Cricket", "Football"]` if any exist) OR create a test batch
2. Switch to "Cricket" sport in SportSelect — batch should appear
3. Switch to "Football" sport — batch should appear
4. Switch to "All Sports" — batch appears under whichever section makes sense

### Task 7 — Visibility throttle
1. Open DevTools → Network tab
2. Switch to another tab for 10 seconds, switch back
3. **Pass:** no new Supabase requests fire
4. Wait 6 minutes, switch tabs, switch back
5. **Pass:** Supabase requests fire (full reload)

### Task 8 — SportSelect
1. Existing academy with sport_branches rows → SportSelect lists all those sports correctly
2. Add a new sport via SportSelect "Add Sport" button → appears immediately
3. Empty academy (no sport_branches, no students yet) → sportList empty but UI renders "Add Sport" prompt

---

## Cleanup recommendations (optional, post-verification)

These were noted during Phase 1 but are not blocking:

### Stale gate_qr rows (post Task 3)
After Phase 1 deploys, old gate_qr rows with `academy_id IS NULL` will be orphaned (no callers ever fetch them again). Optional cleanup:

```sql
-- Optional: remove abandoned pre-Phase-1 gate_qr rows
DELETE FROM gate_qr WHERE academy_id IS NULL;
-- (forces every academy to regenerate their gate QR on next open — minor inconvenience)
```

Or leave them — they're harmless.

### Doc references to old signatures
`AUDIT.md`, `project-memory.md`, `docs/07_DATA_FLOW.md` reference the old `markAttendanceViaQR(studentId, gateToken)` signature. These are documentation only — no JS callers. Update during the next docs sweep.

---

## Phase 2 — what's next (when you say go)

From the master refactor doc:

> "Make permissions real, not decorative" — drop `USING (true)` RLS policies, add JWT-scoped policies, validate staff/student tokens server-side per request.

**This is the highest-risk phase.** A wrong RLS policy can break prod login for an entire academy. Before starting, recommend:
1. Create a Supabase branch (staging copy of prod)
2. Apply RLS migrations on the branch first
3. Smoke-test owner + staff + student login flows on the branch
4. Only then merge to prod

Phase 2 prompt for new session:
> "Pick up Phase 2 from PHASE1_COMPLETE.md. Before any changes, audit current RLS state with `SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname='public'` and show me what's open. Do not modify policies until I approve the migration."

---

## Rollback plan

### JS rollback
```bash
git checkout src/lib/db.js src/pages/AdminQR.jsx src/pages/staff/StaffDashboard.jsx src/pages/student/StudentScan.jsx src/context/AppContext.jsx src/pages/Batches.jsx src/pages/SportSelect.jsx
```

This reverts to the Phase 0 state. All Phase 0 fixes remain intact.

### Database
No new migrations in Phase 1 — everything was JS-only. Migration 0031 from Phase 0 stays in place.

---

## Suggested commit message (when ready)

```
fix: phase 1 — multi-branch stabilization + gate QR tenant scoping

- gate_qr: getOrCreateGateQR/regenerateGateQR/validateGateToken/markAttendanceViaQR
  now require academyId; fixes cross-tenant attendance contamination and
  prevents regenerateGateQR from deleting other academies' rows
- AppContext.sportBatches: replace length-sort primary-sport heuristic with
  sports.includes(selectedSport) so multi-sport batches show under each
- AppContext: throttle visibilitychange loadAll to once per 5 min (saves 6MB
  per quick tab switch on 1000-student academies)
- Batches.getBatchSection: prefer selectedSport over length-sort for grouping
- SportSelect.sportList: derive from sport_branches first, fall back to
  legacy branches[] then students.sport
```
