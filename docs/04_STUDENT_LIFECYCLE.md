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
Optional fields: Parent Name, Parent Phone, Age, Sport, Batch, Training Type, Fee Plan, Join Date, Paid Till

**What happens:**
1. `db.fetchNextStudentCode()` → generates `SA001`, `SA002`, etc.
2. `generateJoinCode()` → 6-char alphanumeric (e.g. `AB3XY7`)
3. `paidTill` month string `2026-05` → normalized to last day of month `2026-05-31`
4. `db.createStudentAccount()` → inserts row with `account_status = 'pending'`
5. If `batchId` set → `db.updateBatchEnrolled(batchId, +1)` + local batch count update
6. **Immediate auto-suspend check**: if `paidTill` is already 3+ days expired → suspend immediately
7. **Auto payment creation**: if `paidTill` + `fees > 0` → creates a `Paid` payment record:
   - `calcHistoricalPayment(joinDate, paidTill, fees, feePlan)` → computes label + amount
   - For `monthly` plan: amount = `fees × monthsCovered`
   - For `quarterly` / `yearly`: amount = `fees` (flat rate)
   - Invoice ID: `INV-{year}-{nextNum}`
   - Payment date = 1st of the start month (not today)
8. Shows toast: `"Student created — Code: SA001 · Join: AB3XY7"`

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

**Key invariant**: `paidTill = null` → never auto-suspended (historical import, no payment data).

---

## Manual Suspend (`suspendStudent`)

Same as auto-suspend but triggered by owner clicking "Suspend" on a student.

---

## Reactivation (`reactivateStudent`)

Two paths:

### Path 1: Manual reactivation (owner button)
1. `db.reactivateStudent(id)` → `status = 'Active'`, `suspended_since = null`
2. If student has `batchId` → `db.updateBatchEnrolled(batchId, +1)`
3. Uses preserved `student.batchId` (never cleared on suspend)

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

---

## Updating a Student (`updateStudent`)

- Same paidTill normalization as add
- Handles batch change: if `batchId` changed → decrement old, increment new
- If `paidTill` + `fees` changed → checks if a payment already exists for that month label
  - If no existing → creates new payment record
  - If existing with different amount → updates amount + monthsCovered
  - If existing with same amount → no-op

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
| Batch | No | dropdown from `batches` table |
| Training Type | No | `Daily` / `Alternate` |
| Fee Plan | No | `Monthly` / `Quarterly` / `Yearly` |
| Join Date | No | defaults today, max today |
| Paid Till | No | month picker (YYYY-MM) |
