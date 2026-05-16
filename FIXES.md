# AUDIT.md Fixes — Progress Report

**Period:** 2026-05-16
**Approach:** safest-first, checkpoint-committed every step, build verified after every change.
**Commit count:** 5 small commits — each is a clean restore point.

---

## ✅ Done

### Phase A — Pure-safe wins (zero behaviour change)

| # | Audit item | Change | Files |
|---|-----------|--------|-------|
| **A.1** | M1 — `fetchLeaveRequests` missing academy filter | Added optional `academyId` param to `fetchLeaveRequests` + `createLeaveRequest`; both callers in AppContext now pass `user.academyId`. Legacy rows with NULL academy_id stay visible (inclusive filter) until backfilled. | `src/lib/db.js`, `src/context/AppContext.jsx` |
| **A.2** | H4 — Business logic in UI | Extracted `isOverdue`, `isNoPayment`, `isOutstanding`, `daysOverdue`, `ageingBucket`, `ageingBucketOrder` to `src/lib/studentRules.js` as pure functions. Wired Students, Payments, Dashboard, Reports to use them. Behaviour identical. | `src/lib/studentRules.js` (new), `Students.jsx`, `Payments.jsx`, `Dashboard.jsx`, `Reports.jsx` |
| **A.3** | M3 — Students filter useMemo | Wrapped `activeStudents`, `suspendedStudents`, `filtered`, `suspFiltered`, `suspBatches`, `suspSports` in `useMemo` with correct dependency arrays. Stops recomputation on unrelated re-renders. | `src/pages/Students.jsx` |

### Phase B — Additive layers

| # | Audit item | Change | Files |
|---|-----------|--------|-------|
| **B.1** | L2 — Structured logging | New `src/lib/logger.js` — single seam for future Sentry. `debug`/`info`/`warn`/`error` + `safe()` helper. Wired into `AppContext.loadAll` error path (was `console.error`). | `src/lib/logger.js` (new), `src/context/AppContext.jsx` |
| **B.2** | H7 — No schema validation | Installed `zod`. New `src/lib/schemas.js` with `studentSchema`, `staffSchema`, `paymentSchema`, `trialSchema`, `batchSchema` and reusable atoms (`phone10`, `email`, `isoDate`, `positiveAmount`, `personName`). **Additive only** — existing imperative validators still run; new code should prefer these. | `package.json`, `src/lib/schemas.js` (new) |
| **B.3** | M6 — Audit log coverage gaps | New ACTION types: `AUTH_STAFF_LOGIN`, `AUTH_STAFF_LOGOUT`, `AUTH_STAFF_ACTIVATE`, `AUTH_STUDENT_LOGIN`, `AUTH_STUDENT_LOGOUT`, `AUTH_STUDENT_ACTIVATE`, `ATTENDANCE_QR_SCAN`. `logAudit` calls added to all 7 paths. Audit tab in Reports will now show accountability events. | `src/lib/audit.js`, `src/context/AppContext.jsx`, `src/pages/student/StudentScan.jsx` |

### Phase C — SQL migrations (written, NOT auto-applied)

Four files under `supabase/migrations/`:

| # | File | What it does | When to apply |
|---|------|--------------|--------------|
| **C.1** | `0001_indexes.sql` | 23 missing indexes on `academy_id`, FK columns, session tokens, hot filters | Anytime — pure perf, additive |
| **C.2** | `0002_backfill_academy_id.sql` | Set `academy_id` on legacy NULL rows (8 tables). Aborts safely if >1 academy exists. | Before C.3 |
| **C.3** | `0003_tighten_owner_rls.sql` | Replaces `USING (true)` with `academy_id = get_my_academy_id()` for the owner (Supabase Auth JWT) path on students, batches, staff, payments, trials, attendance, announcements, events, gate_qr, leave_requests, fee_plans | After C.2 + verification |
| **C.4** | `0004_session_header_rls.sql` | Closes the anon-key (staff/student portal) hole using session-token headers (`x-staff-token`, `x-student-token`). Defines `current_staff_academy()`, `current_student_academy()`, `current_student_id()` SQL helpers. | **Only after Phase D app code is deployed** — see below |

Each file has a verification query and a `-- ROLLBACK` block. See `supabase/migrations/README.md` for apply order.

---

## ⏸ Not done — gated on you running Phase C

### Phase D — App-side guards & header injection

These changes depend on Phase C being applied and verified first. Doing them blind risks breakage:

1. **Inject `x-staff-token` / `x-student-token` headers on the Supabase client.** Once you've run `0004_session_header_rls.sql`, the app must send these for any staff/student data to come back. Without `0004` applied, the headers are harmless no-ops.
2. **Transactional RPCs (`create_student_with_payment` etc.).** AUDIT.md H5 — atomic multi-step writes. Need to create the function in Supabase first.
3. **Replace `PermRequired` with a proper `RouteGuard`.** Defence-in-depth only matters once the DB enforces the rule.
4. **Rate-limit activation + login endpoints (AUDIT.md H6).** Needs a Supabase Edge Function or a Cloudflare WAF rule — infra decision.
5. **Pagination / TanStack Query for the Students/Payments/Attendance lists (H2, M4, M5).** Bigger refactor — out of scope for the safety pass.

---

## How to verify what I did

```powershell
# See the 5 incremental commits
git log --oneline -6

# Should show:
#   chore: add SQL migrations for AUDIT.md criticals (NOT auto-applied)
#   feat: add Zod and lib/schemas (additive — no flows wired yet)
#   feat: logger seam + audit-log coverage for auth & QR scan
#   refactor: extract student finance rules to lib/studentRules
#   fix: scope leaveRequests by academy_id + memoise Students filters
#   testing                            ← the AUDIT.md restore point
```

To revert everything back to before the fixes:

```powershell
git reset --hard 4dac5cc   # the "testing" commit (or its SHA on your end)
```

To revert just the last step:

```powershell
git reset --hard HEAD~1
```

---

## What to do next

1. **Read `supabase/migrations/README.md`.**
2. **Apply `0001_indexes.sql`** in Supabase SQL Editor — zero risk, immediate perf win.
3. **Apply `0002_backfill_academy_id.sql`** — verify with the COUNT query.
4. **Apply `0003_tighten_owner_rls.sql`** — then test owner login + student list load. If anything is missing, run the ROLLBACK block.
5. **Tell me** so we can do Phase D safely.

Until `0003` is applied, your data is still cross-tenant-readable. Until `0004` + Phase D is applied, the staff/student anon paths are still wide open. But the **app-side foundation is in place** so those last two steps are now low-risk mechanical work, not exploratory.
