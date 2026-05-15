# SportFlow CRM — Student Lifecycle

## States

```
pending (account_status)
    ↓ activate
active (account_status) + Active (status)
    ↓ auto-suspend or manual suspend
    Suspended (status)
    ↓ record payment or manual reactivate
    Active (status)
    ↓ delete
    (removed)
```

---

## Adding a Student (`addStudent` in AppContext)

Required fields: Name, Phone, Fee (₹)
Optional fields: Parent Name, Parent Phone, Age, Sport, Batch, Additional Batches, Training Type, Fee Plan, Join Date, Paid Till

**What happens:**
1. `db.fetchNextStudentCode()` → generates `SA001`, `SA002`, etc.
2. `generateJoinCode()` → 6-char alphanumeric (e.g. `AB3XY7`)
3. `paidTill` month string `2026-05` → normalized to last day of month `2026-05-31`
4. `db.createStudentAccount()` → inserts row with `account_status = 'pending'`
5. If `batchId` set → `db.updateBatchEnrolled(batchId, +1)` + local batch count update
6. **Multi-batch enrolment**: if `additionalBatchIds[]` provided → `assignStudentToBatch()` called for each
7. **Immediate auto-suspend check**: if `paidTill` is already 3+ days expired → suspend immediately
8. **Auto payment creation**: if `paidTill` + `fees > 0` → creates a `Paid` payment record:
   - `calcHistoricalPayment(joinDate, paidTill, fees, feePlan)` → computes label + amount
   - For `monthly` plan: amount = `fees × monthsCovered`
   - For `quarterly` / `yearly`: amount = `fees` (flat rate)
   - Invoice ID: `INV-{year}-{nextNum}`
   - Payment date = 1st of the start month (not today)
9. Shows toast: `"Student created — Code: SA001 · Join: AB3XY7"`
10. **Audit logged**: `action = 'student.add'`

---

## Multi-Batch Enrolment

Students can belong to **multiple batches simultaneously** via the `student_batches` junction table.

### Primary Batch vs Additional Batches
- **Primary batch** (`students.batch_id` / `students.batch`): the main batch assignment; controls auto-suspend/reactivate enrolled counts.
- **Additional batches** (`student_batches` table): extra batch memberships. Does not affect the enrolled counter on the primary batch row.

### Assign/Unassign in BatchDetailPanel (`Batches.jsx`)
- Search bar filters students by name
- "Assign" button → `assignStudentToBatch(studentId, batchId, batchName, academyId)` → upsert into `student_batches`
- Enrolled count updated: `updateBatchEnrolled(batchId, +1)` (DB) + local `enrolledAdj` state overlay (instant UI)
- "Remove" button → `unassignStudentFromBatch(studentId, batchId)` → delete from `student_batches`
- Enrolled count updated: `updateBatchEnrolled(batchId, -1)` + local `enrolledAdj`
- "Multi" badge shown on students who are also in this batch via `student_batches` (not primary)
- "Primary" badge shown on students whose `students.batch_id` matches this batch

### Assign Additional Batches at Student Creation (`Students.jsx`)
- "Additional Batches" section in Add Student modal shows toggle-chip buttons for all batches (minus primary)
- After `addStudent()` returns the new student row, `assignStudentToBatch()` is called for each selected additional batch

### StaffAttendance Multi-Batch Roster
When a coach picks a batch in `/staff/attendance`:
1. Primary-batch students are already included via `students.batch_id` filter
2. `fetchBatchEnrolments(batchId)` fetches rows from `student_batches`
3. Multi-batch student IDs stored in `mbStudentIds` (Set)
4. Roster includes any student whose ID is in `mbStudentIds` even if their primary batch differs

---

## Fee Plans

| Plan | `fees` field means | `paidTill` advances | `monthsCovered` |
|---|---|---|---|
| `monthly` | per-month rate | +1 month | 1 |
| `quarterly` | total quarterly flat | +3 months | 3 |
| `yearly` | total yearly flat | +12 months | 12 |

---

## Auto-Suspend Logic

Runs every time `loadAll()` is called (app startup + every data refresh).

**Trigger condition**: `status === 'Active'` AND `paidTill` is 3+ days in the past

```js
const diffDays = Math.floor((now - new Date(paidTill + 'T00:00:00')) / 86400000)
if (diffDays >= 3) → suspend
```

**What suspend does:**
- `db.suspendStudent(id)` → sets `status = 'Suspended'`, `suspended_since = today`
- `db.updateBatchEnrolled(batchId, -1)` → decrements batch count
- Local state: only changes `status` + `suspendedSince`, keeps `batchId`/`batch` intact
- **Why keep batch?**: Coaches can still see suspended students in their roster
- **Audit logged**: `action = 'student.suspend'`

**Key invariant**: `paidTill = null` → never auto-suspended (historical import, no payment data).

---

## Manual Suspend (`suspendStudent`)

Same as auto-suspend but triggered by owner clicking "Suspend" on a student.
- **Audit logged**: `action = 'student.suspend'`

---

## Reactivation (`reactivateStudent`)

Two paths:

### Path 1: Manual reactivation (owner button)
1. `db.reactivateStudent(id)` → `status = 'Active'`, `suspended_since = null`
2. If student has `batchId` → `db.updateBatchEnrolled(batchId, +1)`
3. Uses preserved `student.batchId` (never cleared on suspend)
4. **Audit logged**: `action = 'student.reactivate'`

### Path 2: Auto-reactivation on payment
When `addPayment()` is called for a suspended student:
1. Detects `student.status === 'Suspended'`
2. Calls `db.activateStudentWithBatch(id, batchId, batchName, paidTill, fees)` → sets `status = 'Active'`, updates `paid_till`, `batch_id`, `batch`
3. `db.updateBatchEnrolled(batchId, +1)`
4. Shows toast: `"{Name} reactivated → {batchName}"`

---

## Delete Student (`deleteStudent`)

1. `db.deleteStudent(id)`:
   - Deletes payments (`student_id = id`)
   - Deletes student sessions (`student_id = id`)
   - Deletes student row
2. If `status !== 'Suspended'` AND `batchId` → decrement enrolled
   (Suspended students already had enrolled decremented on suspend — skip to avoid double-decrement)
3. Removes from local `students` + `payments` arrays
4. **Audit logged**: `action = 'student.delete'`

---

## Updating a Student (`updateStudent`)

- Same paidTill normalization as add
- Handles batch change: if `batchId` changed → decrement old, increment new
- If `paidTill` + `fees` changed → checks if a payment already exists for that month label
  - If no existing → creates new payment record
  - If existing with different amount → updates amount + monthsCovered
  - If existing with same amount → no-op
- **Audit logged**: `action = 'student.edit'` with field-level diff (name, batch, fees, paidTill, sport, feePlan, phone)

---

## Student Form Fields Reference

| Field | Required | Notes |
|---|---|---|
| Name | Yes | |
| Phone | Yes | student phone |
| Fee (₹) | Yes | per-month / quarterly / yearly rate |
| Parent Name | No | |
| Parent Phone | No | |
| Age | No | |
| Sport | No | |
| Batch | No | dropdown from `batches` table (primary batch) |
| Additional Batches | No | toggle-chips for extra batch memberships |
| Training Type | No | `Daily` / `Alternate` |
| Fee Plan | No | `Monthly` / `Quarterly` / `Yearly` |
| Join Date | No | defaults today, max today |
| Paid Till | No | month picker (YYYY-MM) |
