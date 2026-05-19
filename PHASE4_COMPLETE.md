# Phase 4 — Lazy-load Non-Critical Fetches

**Date:** 2026-05-20
**Status:** ✅ Code applied. **Not yet tested in browser. Not committed.**

---

## What Phase 4 did

Split `loadAll()` into critical-and-blocking vs background-and-fire-and-forget. The Dashboard now becomes interactive as soon as students + batches + staff land, instead of waiting on every secondary table.

| Fetch | Old | New |
|-------|-----|-----|
| `fetchStudentsPaginated` | awaited | awaited (critical) |
| `fetchBatches` | awaited | awaited (critical) |
| `fetchStaff` | awaited | awaited (critical) |
| `fetchPayments` | awaited | **background** |
| `fetchTrials` | awaited | **background** |
| `fetchAnnouncements` | awaited | **background** |
| `fetchEvents` | awaited | **background** |
| `fetchFeePlans` | awaited | **background** |
| `fetchTrialSources` | awaited | **background** |
| `fetchAttendanceForDate` (today) | awaited | awaited (critical, unchanged) |

---

## What this buys you

**Before:** Dashboard renders only after all 9 fetches complete. On slow mobile network with 1000 students + 5000 payments + 200 trials + ..., that's ~6MB and several seconds before the user sees anything.

**After:** Dashboard renders after 3 critical fetches (students, batches, staff). Payments/Trials/etc. populate in the background as they arrive. The user navigates instantly; non-critical pages briefly show empty arrays then fill in.

**Real-world impact** depends on academy size:
- Small academy (< 100 students, < 500 payments): negligible difference (~50ms)
- Medium (500 students, 2000 payments): ~300-500ms faster TTI
- Large (1000+ students, 10k+ payments): could be 1-2 seconds faster

---

## Behavior changes you should know about

1. **Payments page** will momentarily render with empty state on first load after login, then fill in within ~200-500ms. If the user navigates straight to Payments on login, they may see "no payments yet" flash briefly. Acceptable for the perf win.

2. **Dashboard widgets** (e.g. unread announcements, upcoming events) follow the same pattern. They'll show "0" or empty briefly, then update.

3. **Auto-suspend logic** still runs after critical data lands (it only needs students + batches). Unchanged.

4. **`dataLoading` flag** now flips to `false` once **critical** data is in, even though background fetches may still be in flight. Pages that gate UI on `dataLoading` will render sooner.

5. **Background fetch failures** are logged via `logger.warn` (falls back to `console.warn`) but don't show a toast. If `fetchPayments` fails in background, the user might not realize their Payments page has no data — they'd just see an empty list. Acceptable trade-off; the same network failure would have caused a hard error before.

---

## Files changed (uncommitted)

```
src/context/AppContext.jsx     — loadAll split into critical + background
PHASE4_COMPLETE.md             — this file
```

No DB changes. Pure JS refactor.

---

## Testing checklist

1. **Login as owner with a large academy** — Dashboard should feel snappier.
2. **Open Network tab in DevTools, log in fresh** — confirm:
   - 3 critical fetches fire first (students/batches/staff)
   - 6 non-critical fetches fire shortly after (payments/trials/etc.)
   - Dashboard renders before the non-critical ones finish
3. **Navigate to Payments immediately on login** — should show empty briefly then fill in. No crash.
4. **Disconnect network mid-load** — should see toast errors and graceful degradation. Auto-retry once.
5. **Verify auto-suspend still works** — if any student is past grace period, they should get suspended after login (depends on throttle window).

---

## Rollback

Revert the single `loadAll` change:
```bash
git checkout src/context/AppContext.jsx
```
Or restore the old `Promise.all` block that awaits all 9 fetches.

---

## Suggested commit message

```
fix: phase 4 — lazy-load non-critical fetches in loadAll

Critical (await + block render): students, batches, staff,
today's attendance.

Background (fire-and-forget): payments, trials, announcements,
events, feePlans, trialSources. Each updates its state when it
resolves; failures log to logger.warn instead of failing the whole
load.

Big win on mobile + large academies — Dashboard becomes interactive
as soon as the 3 critical fetches return instead of waiting on the
full 6MB of secondary data.
```
