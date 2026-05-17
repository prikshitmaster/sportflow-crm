# Duplicate-Risk Quick Reference

> Pull-quotes from `QA_AUDIT.md` — for engineers who want to fix duplicates fast.
> Each entry is in the format: **Where / What / Reproduce / Fix snippet.**

---

## 🔴 1. Attendance duplicate rows (UPSERT key mismatch)

**Where:** `src/lib/db.js:828, 845, 1118-1127`

**What:** QR scan upserts on `(date, student_id)`. Coach/admin save upserts on `(date, student_id, batch_id)`. A student scanned at the gate AND marked by their coach gets **two rows** for the same day.

**Reproduce:**
```sql
-- after one QR scan + one coach mark on the same student:
SELECT count(*) FROM attendance
 WHERE student_id = $X AND date = current_date;
-- returns 2
```

**Fix:** Pick one canonical conflict key. In `db.js` line 1124, change:
```js
{ onConflict: 'date,student_id' }
// →
{ onConflict: 'date,student_id,batch_id' }
```
…and have `markAttendanceDirect` look up the student's primary `batch_id` first.

---

## 🔴 2. Batch enrolled counter race (read-modify-write)

**Where:** `src/lib/db.js:314-321`

**What:** Concurrent assigns each read enrolled=10, both write 11. One increment lost.

**Reproduce:** Owner in tab A and owner in tab B both click "Assign Student" on the same batch within ~100ms.

**Fix:** Replace the helper entirely with an atomic SQL expression.

```sql
-- One-time migration (additive):
CREATE OR REPLACE FUNCTION bump_batch_enrolled(p_batch_id BIGINT, p_delta INT)
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE batches SET enrolled = GREATEST(0, COALESCE(enrolled,0) + p_delta) WHERE id = p_batch_id;
$$;
```
Then in `db.js`:
```js
export async function updateBatchEnrolled(batchId, delta) {
  const { error } = await supabase.rpc('bump_batch_enrolled', { p_batch_id: batchId, p_delta: delta })
  if (error) throw error
}
```

---

## 🔴 3. Invoice number collision

**Where:** `src/lib/db.js:927-939`

**What:** `fetchNextInvoiceNum` does `SELECT id FROM payments → regex max + 1` client-side. Two concurrent creates → same invoice id → PK conflict.

**Fix:** Use a Postgres sequence (yearly reset is fine):
```sql
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE OR REPLACE FUNCTION next_invoice_id() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 3, '0');
$$;
```
Then:
```js
export async function fetchNextInvoiceId() {
  const { data, error } = await supabase.rpc('next_invoice_id')
  if (error) throw error
  return data
}
```

---

## 🔴 4. Student code collision

**Where:** `src/lib/db.js:906-917`

**What:** Same regex-max+1 pattern. `SA122` collision under concurrency.

**Fix:** Identical pattern — sequence-based RPC. Reset per academy if needed.

```sql
CREATE SEQUENCE IF NOT EXISTS student_code_seq START 1;
CREATE OR REPLACE FUNCTION next_student_code() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'SA' || lpad(nextval('student_code_seq')::text, 3, '0');
$$;
```

---

## 🔴 5. Attendance month overwrite

**Where:** `src/pages/Attendance.jsx:160`, `src/lib/db.js:874-894`

**What:** `saveAttendanceMonth` upserts the *entire month*. Two tabs each save → cells the second loader didn't see get reverted to the second loader's snapshot.

**Fix:** Track a dirty set. Only push cells the user actually touched.

```js
// In Attendance.jsx:
const [dirty, setDirty] = useState(new Set())  // keys like `${studentId}-${day}`
const cycle = (sid, day) => {
  // ... existing logic
  setDirty(prev => new Set(prev).add(`${sid}-${day}`))
}
const handleSave = async () => {
  const dirtyData = {}
  dirty.forEach(key => {
    const [sid, day] = key.split('-')
    if (!dirtyData[sid]) dirtyData[sid] = {}
    dirtyData[sid][day] = monthData[sid]?.[day] || null
  })
  await db.saveAttendanceMonth(year, month, dirtyData, selectedBatch?.id ?? null)
  setDirty(new Set())
}
```

---

## 🔴 6. Soft-duplicate payment passes through

**Where:** `src/pages/Payments.jsx:682, 1033`

**What:** `isDuplicate` repaints the button red but doesn't disable it. After the server's 60-second dedupe window expires, the same payment can be saved again.

**Fix:**
```js
const isDuplicateBlocked = isDuplicate && confirmText.toUpperCase() !== 'CONFIRM'
// ...
<button … disabled={loading || finalAmount <= 0 || !confirmOk || isDuplicateBlocked}>
```
And surface the CONFIRM input in the same banner already used for `sanityMismatch`.

---

## 🟠 7. Multi-batch assign double-counts

**Where:** `src/pages/Batches.jsx:456-468`

**What:** Assigning a student who's already in the batch (as primary) upserts no-op in DB but the UI counter +1.

**Fix:**
```js
const handleAssign = async (student) => {
  if (isAlternateBlocked(student)) return
  if (primaryIds.has(student.id) || mbStudentIds.has(student.id)) return  // ← add
  // ... rest unchanged
}
```

---

## 🟠 8. Phantom optimistic payment after DB failure

**Where:** `src/context/AppContext.jsx:879-882`

**What:** If `insertPayment` fails, the optimistic UI row stays forever.

**Fix:** Move `setPayments(prev => [{...}, ...prev])` *inside the try block* after `await db.insertPayment(...)` succeeds. Show a fast pending placeholder if perceived latency matters.

---

## 🟠 9. Multi-tab edit of the same student

**Where:** `src/context/AppContext.jsx:650-729` (updateStudent)

**What:** No optimistic-locking. Last write wins.

**Fix:** Add a Supabase `updated_at` check column. Pass the value read into the form, send it on update with a guard:
```js
const { data, error } = await supabase
  .from('students')
  .update(fields)
  .eq('id', id)
  .eq('updated_at', oldUpdatedAt)  // optimistic lock
  .select()
if (data?.length === 0) throw new Error('Edit conflict — please reload and try again')
```

---

## 🟡 10. localStorage clock-in survives DB failure

**Where:** `src/pages/staff/StaffScanIn.jsx:99-102`

**What:** Coach scans QR, localStorage marks them clocked-in, then `logStaffAttendance` throws — DB has nothing, but the app remembers "already clocked in" and won't let them retry tomorrow morning if today's bad write was at 11:59pm.

**Fix:**
```js
if (user?.academyId && user?.id) {
  try {
    await db.logStaffAttendance(user.academyId, user.id, user.name, today, timeStr)
    localStorage.setItem(CHECKIN_KEY(user?.id, today), timeStr)  // ← only on success
  } catch (err) {
    setErrMsg('Clock-in failed — please try again')
    setPhase('error')
    return
  }
}
```

---

## Test plan for verifying fixes

| Fix | Verification step |
|-----|--------------------|
| 1 | `SELECT date, student_id, count(*) FROM attendance GROUP BY 1,2 HAVING count(*) > 1;` should return zero rows after a QR scan + coach mark |
| 2 | Open two browser tabs, both `assignStudentToBatch` simultaneously, expect enrolled +2 not +1 |
| 3 | Spawn two parallel `fetchNextInvoiceId()` calls; both should return distinct IDs |
| 4 | Same as 3 for student codes |
| 5 | Tab A edits day 5, tab B edits day 6, both save — both days retain their respective edits |
| 6 | Try to record a payment for a paid-till-already-covered student; button is disabled until CONFIRM typed |
| 7 | Assign primary-batch student to same batch as multi → enrolled stays unchanged |
| 8 | Force `insertPayment` to fail (drop the payments table temporarily); no orphan rows in `setPayments` |
| 9 | Two tabs edit same student name; first save succeeds, second shows "Edit conflict" |
| 10 | Disconnect network mid-clock-in; no localStorage entry; next attempt succeeds |

---

**See `QA_AUDIT.md` for the full 28-finding stress test report.**
