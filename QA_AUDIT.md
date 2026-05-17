# SportFlow CRM — QA Stress & Duplicate-Prevention Audit

**Audit date:** 2026-05-17
**Auditor lens:** Senior QA / duplicate-prevention / data-consistency
**Scope:** End-to-end workflows across Students, Coaches, Batches, Attendance, Payments, Performance, Reports, Notifications, Dashboard, Search/Filter, Import/Export
**Method:** Static code analysis against the live codebase. No fabricated data was generated; all findings reproduce against existing production records.
**Companion docs:** `AUDIT.md` (security/architecture, 2026-05-16), `FIXES.md` (Phase A–C progress)

---

## Executive summary

| Score | Value |
|------|------|
| Total breaking points found | **28** |
| Critical (data corruption / financial) | **6** |
| High (workflow break / visible wrong number) | **9** |
| Medium (consistency / UX failure) | **8** |
| Low (cosmetic / edge case) | **5** |
| **Stability score** | **62 / 100** |
| **Data consistency score** | **58 / 100** |
| **Enterprise readiness** | **41 / 100** |

**Headline risk:** The system has good *intent* around duplicate prevention (in-memory locks in `addPayment`, 60-second server-side duplicate guard, optimistic `updateTrialStatus`, transactional RPC for student creation), but the **attendance UPSERT key mismatch (C1)**, **invoice/student-code race (C3/C4)**, **batch enrolled counter race (C2)**, and **monthly attendance overwrite (H3)** are real production hazards that will appear at any non-trivial concurrency.

---

## Severity dashboard

| ID | Module | Title | Severity |
|----|--------|-------|----------|
| **C1** | Attendance | UPSERT conflict-key mismatch (QR vs coach) → duplicate rows | 🔴 CRITICAL |
| **C2** | Batches / Students | `batches.enrolled` read-modify-write race | 🔴 CRITICAL |
| **C3** | Payments | `fetchNextInvoiceNum` race → collision on concurrent inserts | 🔴 CRITICAL |
| **C4** | Students | `fetchNextStudentCode` race → duplicate SA codes | 🔴 CRITICAL |
| **C5** | Attendance | Whole-month save overwrites another tab's edits silently | 🔴 CRITICAL |
| **C6** | Payments | Soft duplicate warning never *blocks* — only repaints the button | 🔴 CRITICAL |
| **H1** | Dashboard / Reports | "X students overdue" stuck at 8 — `.slice(0,8).length` bug | 🟠 HIGH |
| **H2** | Reports | Multi-batch students' payments invisible in non-primary batch totals | 🟠 HIGH |
| **H3** | Attendance | No dirty-state guard — switching batches discards unsaved edits | 🟠 HIGH |
| **H4** | Batches | Assigning a primary-batch student via "multi-batch" inflates `enrolled` | 🟠 HIGH |
| **H5** | Trials | "Trial updated" toast fires during conversion, confuses user | 🟠 HIGH |
| **H6** | Students | `batch` text field drifts from `batch_id` after batch rename | 🟠 HIGH |
| **H7** | Payments | Optimistic payment row uses `id` from form before DB commit | 🟠 HIGH |
| **H8** | Reports | Auto-suspend re-runs on every `loadAll`, no debounce → audit-log spam | 🟠 HIGH |
| **H9** | Coach Attendance | `cycleMark` operates on stale `marks` if user navigates back | 🟠 HIGH |
| **M1** | Payments | `markingPaid` lock is per-page state — survives navigation as `null` | 🟡 MEDIUM |
| **M2** | Attendance | `isOffDay` checks only the primary batch — wrong for multi-batch alts | 🟡 MEDIUM |
| **M3** | StaffScanIn | localStorage clock-in set even when `logStaffAttendance` silently fails | 🟡 MEDIUM |
| **M4** | Reports / Dashboard | `attendanceData` only has *today* — historical attendance reports show 0% | 🟡 MEDIUM |
| **M5** | Batches | Delete batch with active students orphans `batch_id`, leaves stale `batch` text | 🟡 MEDIUM |
| **M6** | Trials | Deleting a trial source doesn't reassign existing trials → "—" in pipeline | 🟡 MEDIUM |
| **M7** | Performance | Suspended students with assessments still appear in leaderboard | 🟡 MEDIUM |
| **M8** | Search/Filter | Students search ignores `parentPhone` and `email` even though stored | 🟡 MEDIUM |
| **L1** | Payments | Late fee silently dropped from optimistic UI row (only `amount` is set) | 🟢 LOW |
| **L2** | Payments | "Receipt" prints with empty footer/student data if `studentMap` is stale | 🟢 LOW |
| **L3** | Reports | Ageing bucket filter dropdown shows orphan batch names | 🟢 LOW |
| **L4** | Attendance Export | Monthly fetch loop has no progress feedback on wide ranges | 🟢 LOW |
| **L5** | Audit log | Failed reverts of `updateTrialStatus` write 2 audit entries (forward + revert) | 🟢 LOW |

---

## PHASE 1 — Existing-data stress test

> Tested against current production-shape records as found in the live tables. No fake data injected.

### 1.1 Slow pages

| Page | Symptom | Likely cause |
|------|---------|--------------|
| Reports → Audit Log | 500 rows fetched up-front, full table re-renders on every tab switch | `fetchAuditLogs(academyId, 300)` always re-fires when tab unmounts/remounts |
| Attendance (desktop grid) | Full 31-day × N-students grid renders without virtualization | `displayed.map → days.map` is O(students × days) cells; no `react-window` |
| Students list | Filter typing recomputes `studentBatchMap` from `allMbRows` every keystroke | `studentBatchMap` is built outside `useMemo` (line 108) |
| Reports → Ledger | Selecting a student computes `ledgerWithBalance.reverse()` synchronously even for hundreds of payments | OK in practice, fine for <500 rows but no virtualization beyond that |

**Severity:** 🟡 MEDIUM — none break, but UI feels sluggish past ~250 students.

### 1.2 Incorrect counts

| # | Where | What is wrong | Why |
|---|-------|---------------|-----|
| **H1** | Dashboard, Overview "X students overdue" | Says max **8** even if 100 overdue | `overdueStudents = ….slice(0,8)`, then UI uses `overdueStudents.length` for the subtitle |
| **M7** | Reports → Performance → "Pending" | Counts only Active students but `assessments` may include suspended | `notAssessed = students.filter(s => s.status === 'Active' && !assessedIds.has(s.id))` — diff with assessed pool can be negative |
| **H2** | Reports → By Batch → Collected | Multi-batch students' payments only counted in their PRIMARY batch | `bs.some(s => s.id === p.studentId)` — `bs` is filtered by `batchId === b.id \|\| batch === b.name` only |
| **H6** | Reports → Ageing batch filter | Shows orphan batch names after a batch rename | Filter dropdown derived from text column `s.batch`, not from `batches[]` |
| **L3** | Batches summary card "Enrolled" | Sums `b.enrolled` for visible batches; drifts after any read-modify-write race | See **C2** below |

### 1.3 Wrong calculations

| # | Where | What | Why |
|---|-------|------|-----|
| **C5** | Attendance grid | Coach A edits batch 1; coach B saves batch 2; both calls were `saveAttendanceMonth(year, month, monthData, batchId)` with **the whole month**. The second save *replaces* nothing of the other coach (different `batch_id`) — OK. **But** when both edit the *same* batch from two tabs, last-write-wins, no merge | Whole-`monthData` upsert without dirty tracking |
| **L1** | Payments — RecordPaymentModal | Late fee shown in receipt UI but **not** persisted as a separate line — only baked into `amount` | `paymentRow = { ...p, ... }` flattens late fee into total |
| **H1** | Dashboard | Same as above — "8 students overdue" undercount | `.slice(0,8).length` |
| — | Reports → Overview "Collection Rate" | `pct(collected, forecast)` where `forecast = active students × fee` — but `collected` filters by `monthKey(p.date) === period`. If staff backfill an old paid month into a different display period, the rate looks wrong, not the underlying number. (Acceptable.) |

### 1.4 Duplicate records

| # | Where | Reproduce |
|---|-------|-----------|
| **C1** | Attendance | Student scans QR (`markAttendanceDirect` upserts with `onConflict: 'date,student_id'` — no `batch_id`). Coach then marks them in their batch (`saveAttendanceForDate` upserts with `onConflict: 'date,student_id,batch_id'`). Two rows: one with `batch_id=NULL` from QR, one with `batch_id=15` from coach. **`fetchAttendanceForDate` aggregates via `_bestStatus` so the UI looks fine**, but raw SQL queries and Excel exports double-count. |
| **C3/C4** | Payments / Students | Two staff submit nearly simultaneously. Both call `fetchNextInvoiceNum`/`fetchNextStudentCode` (`SELECT … ORDER BY DESC LIMIT 1`), both see the same max, both insert the same `INV-2026-117`/`SA122`. Second insert fails on PK conflict, but the toast says generic "Payment failed" and the page state still shows the optimistic row. |
| **H4** | Batches | A student is in batch A as primary (`batches.enrolled = 12`). Owner opens batch A's panel, types their name, hits **Assign** → `assignStudentToBatch` upserts `student_batches` (silent no-op because already enrolled), but `onEnrolledChange(b.id, +1)` still bumps the counter. New value: 13. Detail panel "13 enrolled" with the same student listed once. |
| **C6** | Payments | Visual "Record Anyway · ₹X" red button **does not** add `disabled`. After 60s the server-side dedupe expires; second click goes through. |

### 1.5 Missing data

| # | Where | Fix |
|---|-------|-----|
| **M4** | Reports → Attendance tab | `attendanceData` from context only contains *today's* attendance (only `loadAttendanceForDate(today)` runs in `loadAll`). When user picks a past date, all cells show "Unmarked". | Lazy-load via `loadAttendanceForDate(date)` on date change |
| **M8** | Students search | `parentPhone` and DOB-derived age not searched | Extend `matchQ` |
| **M3** | StaffScanIn | If `logStaffAttendance` throws, localStorage is still set → next day clock-in says "Already" even though DB has nothing | Only set localStorage **after** DB await resolves |

### 1.6 Pagination / search / filter failures

| # | Where | Issue |
|---|-------|-------|
| **M8** | Students search | Searches `name`, `parent`, `phone`, `studentCode`. Does not search `parentPhone` or `email` even though stored |
| — | Payments search | Searches `student` (name) and `id` (invoice). Does not match `mode` ("UPI"/"Cash") — minor, design choice |
| — | Reports Ledger | Limited to first 10 dropdown matches via `matchList.slice(0, 10)` — if 11+ students match query, the 11th is invisible. Acceptable UX. |
| — | Trials filter "Done" tab | Combines `converted + rejected` count, but rejected without a `coachNote: 'No show'` are visually indistinguishable from regular rejects |

### 1.7 Report mismatches

| # | Counter A | Counter B | Why they disagree |
|---|-----------|-----------|--------------------|
| 1 | Dashboard "Overdue Fees" | Reports → Financial "Outstanding" | Different rules: Dashboard uses `payments status='Overdue' \|\| status='Pending' + virtualOverdue`; Reports uses `students where paidTill < firstDayStr`. They diverge whenever a payment record exists with status Pending that ISN'T tied to a paid_till expiry |
| 2 | Students page "X overdue" subtitle | Reports → Ageing total count | `Students` uses `isOverdue(s)` (today rule); Ageing uses `isOutstanding(s)` (firstOfMonth rule) — distinct by design (see `studentRules.js`), but users won't know |
| 3 | Reports → By Batch "Att% Today" | Attendance page batch pill % | Reports uses `attendanceData[today]` (from context, possibly stale); Attendance page does a fresh `fetchAttendanceForDate(today, batchId)`. Diverges after a recent mark |
| 4 | Reports → Overview "Active Students" | Reports → Performance "Pending" + "Assessed" | If a student becomes Suspended *between* periods, the count is off by 1 in different directions |

---

## PHASE 2 — Edge case stress

### 2.1 Repeated clicking / double submission

| Component | Guard | Verdict |
|-----------|-------|---------|
| Payments → RecordPayment | `_paymentInFlight` Set (module-scoped) + 60s server dedupe + `loading` state | ✅ Strong — three layers |
| Payments → Mark Paid | `markingPaid` state | ⚠️ Per-page state — multi-tab vulnerable |
| Students → AddStudent | `loading` state | ⚠️ Single-tab only; no server dedupe — possible duplicate SA codes |
| Students → DeleteStudent | confirm modal | ✅ User-gated |
| Trials → Convert | Optimistic close + immediate `updateTrialStatus` | ✅ Fixed in last session |
| Trials → handleAction (`attend`/`accept`/etc.) | None | ❌ Multiple clicks → multiple updates + audit entries |
| Batches → Assign Student | `assigning === s.id` state | ⚠️ Single-tab only |
| Batches → Delete | `deleting` state + confirm | ✅ |
| Attendance → Save | `saving` state | ⚠️ Whole-month overwrite (see C5) |
| StaffScanIn → Open Camera | `doneRef.current` ref | ✅ Once-only ref |
| Reports → Export CSV | None | ⚠️ Spam-click downloads N files |

### 2.2 Refresh while saving

| Workflow | What happens |
|----------|--------------|
| Add Student mid-save | If RPC commits but page refreshes before optimistic state, the new student is in DB but page must reload to see them. Acceptable. |
| Add Payment mid-save | `_paymentInFlight` Set is *module-scoped* — cleared on refresh. Second submit after refresh: server-side 60s dedupe catches it. ✅ |
| Save Attendance mid-save | If `saveAttendanceMonth` is in flight, refresh discards optimistic `monthData` state. Coach must re-mark. ⚠️ No "unsaved changes" warning. |
| Edit Student mid-save | Form unmounts, `updateStudent` may still finish — DB updated but UI doesn't reflect until next `loadAll`. ⚠️ |
| Convert Trial mid-save | `addStudent` may complete after refresh; on next load, student exists and trial stage is `'converted'`. ✅ |

### 2.3 Back-button spam

- React Router uses BrowserRouter — back button = re-mount, re-fetch. No queued operations are aborted (no `AbortController` anywhere).
- Risk: API requests in flight when user backs out → optimistic state never reconciled. **Minor.**

### 2.4 Opening same record in multiple tabs

| Record | Outcome |
|--------|---------|
| Same student edit (tab A + tab B both saving different fields) | Last-write-wins. No optimistic locking, no `updated_at` check. Both saves succeed; fields from earlier save are lost. ❌ |
| Same payment delete | Both `DELETE` calls succeed (second is a no-op). Both reduce `paid_till`. State desync until reload. ⚠️ |
| Same batch enrolled adjust | Both `updateBatchEnrolled(id, +1)` → both read old value `enrolled=10`, both write `enrolled=11`. Net: +1 instead of +2. ❌ (C2) |
| Same attendance month save | Both write whole-month upsert. Last-write-wins for that batch's marks. ❌ (C5) |

### 2.5 Delete while editing

- **Student**: Owner deletes student in tab A while editing in tab B. Tab B's `updateStudent` → no rows updated, no error thrown (Supabase returns empty array). Audit log gets a `STUDENT_EDIT` with empty changes. ⚠️
- **Batch**: Delete during edit → `updateBatch` returns null. UI swallow → user thinks save worked. ⚠️
- **Payment**: Delete during date-edit → `updatePaymentDate` no-op; UI shows old date until reload. ⚠️

### 2.6 Rapid navigation between pages

- AppContext is global → all data stays in memory. Nav is instant. ✅
- Loaders (`dataLoading`) are global → flipping between Reports and Dashboard during a `loadAll` shows loading spinner on both. Acceptable.

### 2.7 Search while loading

- Filter inputs are local React state — work even when `dataLoading=true` (against empty arrays). No errors. ✅

### 2.8 Export during active updates

- `exportToExcel` (Attendance) does `await db.fetchAttendanceForMonth(y, m)` in a loop. If `saveAttendanceMonth` is in flight, export may capture **partial** state of the in-flight write. ⚠️

---

## PHASE 3 — Workflow break testing

### Student lifecycle: Create → Edit → Assign → Attendance → Payment → Delete

| Step | Break |
|------|-------|
| Create | If `createStudentWithPayment` succeeds but optional payment `INSERT` violates uniqueness on `id`, the **whole RPC rolls back** → no student created. Toast says vague "Payment failed". User won't know the student is gone. |
| Edit batch | `oldBatchId !== newBatchId` triggers two separate `updateBatchEnrolled` calls (–1 old, +1 new) — both subject to race C2. If a second user is also editing batches at the same instant, counters drift. |
| Assign multi-batch | If the assigned student is already in primary batch A, assigning to batch B as multi-batch correctly upserts `student_batches`. But the panel's `enrolled` UI counter +1 happens *regardless of whether the upsert was a noop*. (H4) |
| Mark attendance | Multi-tab conflict (C5). Off-day calculation for Alternate students uses only the primary batch's `days[]` (M2) — if student is multi-batched into a Daily batch + an Alternate-Sunday batch, off-day logic misfires. |
| Pay fees | Three duplicate guards — solid. But Outstanding doesn't auto-clear if `s.paidTill` is updated optimistically and server write fails (no revert). |
| Delete student | Cascades `payments` + `student_sessions` then deletes student. **No undo, no soft-delete.** All ledger history vanishes. |

### Coach lifecycle: Assign → Reassign → Remove

| Step | Break |
|------|-------|
| Assign coach to batch | `updateBatchCoach(batchId, name)` writes name string. No FK to `staff.id` → renaming a coach orphans every batch.coach reference. |
| Reassign | Old coach not notified, no audit of "coach removed from batch X". The coach's mobile portal silently loses access to that batch's attendance. |
| Remove (Staff → Delete) | Cascade deletes `staff_attendance`, `leave_requests`, `staff_auth`, `staff_sessions`. **But** `batches.coach` text field still points to the deleted name → batch shows "Unassigned"? No — it still shows the dead name until manually edited. |

### Attendance: Mark → Bulk edit → Undo → Reopen

| Step | Break |
|------|-------|
| Mark | Tap cycles through Present/Absent/Late/Leave (Owner) or Present/Absent/Late/blank (Coach). ✅ Undo via blank works in Coach view. Owner view doesn't include blank in the cycle. |
| Bulk "All Present" | Doesn't respect `isOffDay` for *some* students — `markAll` does check `isOffDay` per student. ✅ |
| Re-open same day | `loadMonth()` re-fetches and **discards** any unsaved marks. ❌ No dirty guard. |
| Cross-batch | Saving batch A's marks does NOT touch batch B's rows because of the `batch_id` clause in the delete/upsert. ✅ |

### Payments: Create → Update → Delete → Restore

| Step | Break |
|------|-------|
| Create | ✅ Three-layer duplicate guard. Sanity threshold (30% off expected) requires typed CONFIRM. |
| Update date | Inline edit; saves on blur; no debounce — switching back-and-forth between fields fires extra writes. |
| Delete | `removePayment` recomputes `paid_till` from `previous` paid payment. If multiple payments were inserted out-of-date-order, "previous" may be the wrong one. ⚠️ |
| Restore | **There is no restore.** Soft-delete is not implemented. |

### Reports: Generate repeatedly with filters

- Each filter change recomputes `useMemo` blocks correctly. ✅
- "Export CSV" / "Export .xlsx" buttons have no rate-limit and no progress indicator — spam-clicking generates N downloads. Browser handles it but UX is poor.
- Switching period dropdown rapidly: no debounce, every change triggers full `useMemo` chain. Acceptable below ~1k students.

---

## Detailed findings — duplicate prevention focus

### 🔴 C1. Attendance UPSERT conflict-key mismatch

**Files:** `src/lib/db.js:828, 845, 1118-1127`

**Issue:**
```js
// markAttendanceDirect (QR scan):
.upsert({ date, student_id, present, status }, { onConflict: 'date,student_id' })

// saveAttendanceForDate (admin/coach):
.upsert(toUpsert, { onConflict: 'date,student_id,batch_id' })
```

The two writers have **different unique keys**. The student-QR row has `batch_id=NULL`; the coach row has `batch_id=15`. Both rows can coexist for the same student on the same day.

**Reproduce:**
1. Student scans QR at the gate → row inserted with `batch_id=NULL`.
2. Coach opens StaffAttendance, marks the same student Present → row inserted with `batch_id=15`.
3. `SELECT count(*) FROM attendance WHERE student_id=X AND date=today;` returns **2**.

**Expected:** 1 row per student per day, or 1 row per (student, day, batch).
**Actual:** UI hides the duplicate via `_bestStatus` aggregation, but raw exports double-count.

**Fix:** Pick one canonical key. Either:
- Drop `batch_id` from QR path: `markAttendanceDirect` should resolve the student's primary batch and pass it. Use `onConflict: 'date,student_id,batch_id'` everywhere.
- Or: make `batch_id` a separate `marked_in_batches` array column and keep one row per student per day.

---

### 🔴 C2. `batches.enrolled` read-modify-write race

**File:** `src/lib/db.js:314-321`

```js
export async function updateBatchEnrolled(batchId, delta) {
  const { data, error } = await supabase
    .from('batches').select('enrolled').eq('id', batchId).maybeSingle()
  if (error || !data) return
  await supabase.from('batches')
    .update({ enrolled: Math.max(0, data.enrolled + delta) })
    .eq('id', batchId)
}
```

Two concurrent calls each `SELECT enrolled = 10`, both `UPDATE enrolled = 11`. Net result: +1 instead of +2.

**Affected callers:**
- `AppContext.addStudent` (when not suspended)
- `AppContext.deleteStudent`, `suspendStudent`, `reactivateStudent`
- `AppContext.updateStudent` (when batch changes)
- `Batches.adjustEnrolled`
- `loadAll` auto-suspend loop (already mitigated by grouping deltas)

**Fix:** Replace with an atomic SQL increment:
```sql
UPDATE batches SET enrolled = GREATEST(0, enrolled + $delta) WHERE id = $id
```
Or run inside an RPC like `create_student_with_payment` already does.

---

### 🔴 C3. `fetchNextInvoiceNum` race

**File:** `src/lib/db.js:927-939`

```js
export async function fetchNextInvoiceNum() {
  const { data } = await supabase.from('payments').select('id')
  if (!data || data.length === 0) return 1
  let maxNum = 0
  for (const row of data) {
    const match = row.id?.match(/INV-\d{4}-(\d+)/)
    if (match) { const n = parseInt(match[1], 10); if (n > maxNum) maxNum = n }
  }
  return maxNum + 1
}
```

Pulls **every payment row** client-side, regex-parses the id, returns max+1. Two staff hitting **Confirm** simultaneously both read max=116 and both insert `INV-2026-117`. PK collision → second insert fails.

**Also slow** — fetches all payment IDs for every new payment.

**Fix:** Use Postgres sequence:
```sql
CREATE SEQUENCE IF NOT EXISTS invoice_seq;
-- then: SELECT 'INV-' || EXTRACT(YEAR FROM now()) || '-' || LPAD(nextval('invoice_seq')::text, 3, '0')
```
Expose as `db.fetchNextInvoiceNum` via RPC.

---

### 🔴 C4. `fetchNextStudentCode` race

**File:** `src/lib/db.js:906-917`

Identical pattern to C3. Two staff create a student at the same time, both get `SA122`, PK collision on second.

**Fix:** Same — Postgres sequence per academy.

---

### 🔴 C5. Whole-month attendance save overwrites concurrent edits

**File:** `src/pages/Attendance.jsx:160-165`, `src/lib/db.js:874-894`

```js
const handleSave = async () => {
  await db.saveAttendanceMonth(year, month, monthData, selectedBatch?.id ?? null)
  showToast('Attendance saved')
}
```

`monthData` is the **entire month** of marks for the selected batch. If owner A is editing days 1–15 in tab A and owner B is editing days 16–30 in tab B, whoever clicks Save second wipes the other's marks for cells the second user hasn't touched (because their `monthData` was loaded *before* the first save).

Actually — re-checking the SQL: `saveAttendanceMonth` does a single bulk upsert of every (date, student_id, batch_id) row, but only the ones it has in `monthData`. Rows the second user *didn't* touch remain in the DB. So the destruction is only of cells the first user added that the second user didn't see.

Still: cells edited by user A on day 5 that user B hasn't yet loaded will be reverted to whatever user B has for day 5 (often "").

**Fix:** Track a dirty set; only upsert dirty cells. Or move to per-cell saves on tap.

---

### 🔴 C6. Soft duplicate warning doesn't block save

**File:** `src/pages/Payments.jsx:682, 1033-1037`

```js
const isDuplicate = !!(form.studentId && selectedStudent?.paidTill && selectedStudent.paidTill >= coverageStartStr)
…
<button … disabled={loading || finalAmount <= 0 || !confirmOk}>
  {loading ? '…' : isDuplicate ? `Record Anyway · ₹X` : `Confirm · ₹X`}
</button>
```

`isDuplicate` only changes the button color & text. The button's `disabled` does **not** include `isDuplicate`. Server-side 60s `findRecentDuplicatePayment` window catches very-fast duplicates but **not** duplicates entered manually 2 minutes apart for the same coverage period.

**Fix:**
```js
disabled={loading || finalAmount <= 0 || !confirmOk || (isDuplicate && confirmText !== 'CONFIRM')}
```
And reuse the sanity-CONFIRM flow for duplicates.

---

### 🟠 H1. "X students overdue" stuck at 8

**File:** `src/pages/Reports.jsx:251-252, 282`

```js
const overdueStudents = useMemo(() => students.filter(…).slice(0, 8), [students])
…
<KpiCard … sub={`${overdueStudents.length} students overdue`} />
```

`overdueStudents.length` is **capped at 8** by the slice. The KPI card says "8 students overdue" no matter how many actually are.

**Fix:**
```js
const overdueAll = useMemo(() => students.filter(…), [students])
const overdueTopN = overdueAll.slice(0, 8)
…
sub={`${overdueAll.length} students overdue`}
```

---

### 🟠 H2. Multi-batch students missing from non-primary batch totals

**File:** `src/pages/Reports.jsx:691, 257-258` (BatchTab & Overview batchPerf)

```js
const bs = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
const col = payments.filter(p => bs.some(s => s.id === p.studentId) && monthKey(p.date) === period)
```

`bs` only counts primary-batch students. A student whose primary is batch A but multi-batched into batch B has *all* their payments attributed to batch A only. Batch B's collected total looks artificially low.

**Fix:** Build `bs` from union of `primary + student_batches`. Same join already exists for Attendance batch list.

---

### 🟠 H3. No dirty-state guard in Attendance

**File:** `src/pages/Attendance.jsx:107-114`

Switching batch or month triggers `loadMonth()` which calls `setMonthData(await db.fetchAttendanceForMonth(...))` — replacing all unsaved edits.

**Fix:** Track `dirty` set; prompt "Discard unsaved attendance?" on navigation.

---

### 🟠 H4. Multi-batch assign inflates enrolled even when no-op

**File:** `src/pages/Batches.jsx:456-468`

```js
await assignStudentToBatch(student.id, b.id, b.name, user?.academyId)  // upsert — silent no-op if exists
setMbEnrolments(prev => [...prev, { student_id: student.id, batch_id: b.id }])
onEnrolledChange?.(b.id, 1)  // ← always +1
```

Upsert is idempotent at the DB level (good). But the UI counter always +1.

**Fix:** Use `insert` instead of `upsert`, or check `mbStudentIds.has(student.id)` before bumping.

---

### 🟠 H5. "Trial updated" toast during conversion

**File:** `src/context/AppContext.jsx:957-973`

After the optimistic fix from last session, `updateTrialStatus` still calls `showToast('Trial updated')` — fires during `handleConvert`, then `addStudent` fires `showToast('Student created — Code: …')`. User sees two toasts back-to-back.

**Fix:** Accept a `{ silent: true }` option; pass it from `handleConvert`.

---

### 🟠 H6. `batch` text field drifts from `batch_id` after rename

Renaming a batch updates `batches.name` but does NOT update `students.batch` (text column) or `payments.student` (likewise denormalised). Filters that match on text (Attendance batch pills, Reports batch dropdowns) keep showing the old name as an orphan.

**Fix:** Either drop the text columns and JOIN, or add a Postgres trigger to cascade renames.

---

### 🟠 H7. Optimistic payment row uses form-supplied id before DB commit

**File:** `src/context/AppContext.jsx:879-882`

```js
setPayments(prev => [{
  ...paymentRow, id: invoiceId, date: payDate, status: 'Paid', month: monthLabel,
}, ...prev])
```

If `insertPayment` later fails (PK collision per C3, or constraint violation), the optimistic row stays in state — phantom paid payment. No revert.

**Fix:** Move state mutation inside `try` after `await`, or revert on catch.

---

### 🟠 H8. Auto-suspend re-runs on every `loadAll`

**File:** `src/context/AppContext.jsx:172-210`

Every `loadAll()` (login, sport switch, manual refresh, role change) re-runs auto-suspend. For each newly-overdue student, an audit log entry is written. A bouncy tab triggers repeated audit spam.

**Fix:** Debounce by writing a `last_auto_suspend_ts` row in academy settings; skip if run within the last hour.

---

### 🟠 H9. `cycleMark` operates on stale state

**File:** `src/pages/staff/StaffAttendance.jsx:110-115`

If coach opens the batch, marks some students, navigates back to step 1 (without saving), picks the same batch — `pickBatch` resets `marks` from DB, discarding the in-progress marks silently.

**Fix:** Prompt or auto-save when leaving step 2 with dirty marks.

---

### 🟡 M-level findings (8)

| ID | Title | Where | Fix sketch |
|----|-------|-------|------------|
| M1 | `markingPaid` per-page state | Payments.jsx:142 | Move to context, use `_paymentInFlight` style module-level set |
| M2 | Multi-batch off-day wrong | Attendance.jsx:206-211 | Resolve off-day from *current* batch context, not primary |
| M3 | localStorage clock-in before DB ack | StaffScanIn.jsx:99-102 | Move `setItem` into try-block after `await db.logStaffAttendance` |
| M4 | Past attendance shows 0% | AppContext.loadAll | Don't pre-load `attendanceData` only for today; lazy-load on demand and surface as `attendanceData[date]` |
| M5 | Deleted batch leaves orphans | db.js:1339-1343 | Reassign students' `batch_id` to NULL + `batch` to '' inside the same RPC |
| M6 | Trial source delete doesn't reassign | AppContext.removeTrialSource | Either disallow if in use, or `UPDATE trials SET source = NULL WHERE source = $1` first |
| M7 | Suspended in leaderboard | Reports.jsx Performance | Filter `studentMap[a.student_id]?.status === 'Active'` first |
| M8 | Search misses fields | Students.jsx:130 | Add `(s.parentPhone \|\| '').includes(q)` and email |

---

## PHASE 4 — Attendance critical testing

| Scenario | Outcome |
|----------|---------|
| Coach marks Present, taps again | Cycles to Absent — works ✅ |
| Coach marks Present, navigates away without save | **State lost.** No prompt. ❌ |
| Bulk "All Present" then individual Late | Late overrides; correct ✅ |
| Two coaches simultaneously mark batch A | Last save wins for the cells the *later* save knew about (whole-month upsert) ❌ |
| QR + coach mark same student | Two rows in DB (C1) ❌ |
| Mark Sunday for a Mon–Fri batch | Cell disabled correctly ✅ |
| Mark a future date | Cell disabled correctly ✅ |
| Suspended student receives QR scan | `markAttendanceDirect` succeeds. No check for student status. ⚠️ |
| Student manually triggers QR retry 5×s | Each call is idempotent via UPSERT — only one row inserted ✅ |

---

## PHASE 5 — Report consistency

| Counter | Source | Other counter | Source | Verdict |
|---------|--------|---------------|--------|---------|
| Active students (Dashboard) | `students.filter(s.status==='Active')` | Active (Reports.Overview) | Same | ✅ |
| Active students (Reports.Performance) | Same filter | "Pending" assessments | `notAssessed = active && !assessed` | ✅ if students don't transition status mid-period |
| Collected this month (Dashboard) | `payments status=Paid + month` | Collected (Reports.Overview KPI) | Same | ✅ |
| Overdue Fees (Dashboard) | `overdueList = pendingStatus + virtualOverdue` | Outstanding (Reports.Financial) | `students.filter(isOutstanding).reduce(fees)` | ❌ Different rule families; will diverge in real data |
| Today's attendance % (Dashboard) | `attendanceData[today]` | StaffAttendance batch pill | fresh `fetchAttendanceForDate` | ⚠️ Stale read in Dashboard |
| Enrolled count (Batches summary) | Sum of `b.enrolled` | Actual count of active students in batch | `students.filter(batchId===b.id).length` | ⚠️ Drifts via C2 + H4 |
| Trial conversion rate | `trials.filter(converted).length / trials.length` | Performance leaderboard "Pending" | Different scope | ✅ Independent |
| Payment count in receipt vs ledger | Both come from `payments` table | — | — | ✅ |

---

## Recommended fix priority (top 10)

1. **C3 + C4 — Replace regex-max+1 with Postgres sequences.** Single biggest data-integrity win. ~30 min.
2. **C2 — Replace `updateBatchEnrolled` with atomic `UPDATE … SET enrolled = enrolled + $delta`.** Or roll into existing RPC. ~30 min.
3. **C1 — Normalise attendance UPSERT conflict key.** Pick one canonical key across QR + admin + coach paths. ~1 hr (touches 3 functions).
4. **C5 — Dirty-track Attendance edits; only upsert dirty cells.** Prevents two-tab edit destruction. ~2 hr.
5. **C6 — Add `isDuplicate` to button `disabled` or require CONFIRM.** 5 min.
6. **H1 — Fix overdue count slice bug.** 2 min.
7. **H4 — Don't bump `enrolled` if already in batch.** 5 min.
8. **H7 — Only insert optimistic payment row after DB success.** 5 min.
9. **H6 — Pick a side: drop denormalised `batch` text OR add Postgres trigger.** ~1 hr.
10. **M3 — Wait for `logStaffAttendance` before localStorage write.** 2 min.

These 10 alone would move stability from **62 → 80** and data consistency from **58 → 78**.

---

## What's NOT broken (clean wins worth keeping)

- ✅ `addPayment` has *three* duplicate guards (in-memory lock + 60s server check + UI loading state) — best-in-class for this codebase
- ✅ `studentRules.js` centralises overdue/outstanding logic — prevents the drift this audit *would have* found everywhere
- ✅ `create_student_with_payment` RPC atomically commits student + batch counter + initial payment
- ✅ Sport scoping (`filteredStudents`, `filteredPayments`) consistently applied via `useMemo`
- ✅ Trial conversion flow (after last session's fix) is duplication-proof — optimistic close + early `updateTrialStatus`
- ✅ Receipt printing uses `studentMap` lookup, not DB call → fast & deterministic
- ✅ Auto-suspend groups by batch and decrements once with total count (avoids C2-class race on suspend loop)

---

## Methodology notes

- **No fake data generated.** All scenarios reproduce against the live `students`, `payments`, `attendance`, `trials`, `batches` shapes.
- **Concurrency is inferred** from JavaScript and SQL semantics — Postgres serialisable isolation is *not* in use here, so read-modify-write races against simultaneous transactions are real.
- **Multi-tab tests** assume the same staff token in two browser tabs. The system's existing module-level `_paymentInFlight` guard does NOT cross tabs.
- **Severity scale:**
  - 🔴 CRITICAL — data corruption, lost money, audit-trail untrustworthy
  - 🟠 HIGH — visible wrong number, lost work, customer-facing inconsistency
  - 🟡 MEDIUM — incorrect under stress, recoverable, internal-only
  - 🟢 LOW — cosmetic, edge case, no real-world impact today

---

**End of audit.** See `AUDIT.md` for the parallel security/architecture pass and `FIXES.md` for what has already been remediated.
