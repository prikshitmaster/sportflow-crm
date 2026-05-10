# Payment & Student Add Architecture

## 1. Add Student Flow

### Form fields
| Field | Type | Required |
|-------|------|----------|
| Name | text | ✓ |
| Student Phone | text | ✓ |
| Fee (₹) | number | ✓ |
| Fee Plan | Monthly / Quarterly / Yearly | ✓ |
| Join Date | date (YYYY-MM-DD) | optional |
| Paid Till | **month picker (YYYY-MM)** | optional |
| Batch, Training Type, Age, Parent, Parent Phone, Sport | various | optional |

### Auto-compute Paid Till
When the user selects **Join Date** or changes **Fee Plan**, `Paid Till` is auto-filled:
- Monthly → same month as join (e.g. Apr 2026 → `2026-04`)
- Quarterly → 3rd month from join (e.g. Apr 2026 → `2026-06`)
- Yearly → 12th month from join (e.g. Apr 2026 → `2027-03`)

The "Covers: Apr 2026 · 1 month" preview shows below the field.

### On Save (`AppContext.addStudent`)
1. `db.fetchNextStudentCode()` → queries max `SA###` in DB → returns `SA(max+1)`
2. `generateJoinCode()` → random 6-char alphanumeric
3. Convert `paidTill` YYYY-MM → last day of that month (e.g. `2026-04` → `2026-04-30`)
4. `db.createStudentAccount(...)` → INSERT into `students`
5. If batch selected → `db.updateBatchEnrolled(batchId, +1)`
6. If `paidTill` set AND `fees > 0` → auto-create a **Paid / Cash** payment:
   - `calcHistoricalPayment(joinDate, paidTill, fees, feePlan)` → `{ monthsCovered, label, amount, startDate }`
   - `startDate` = 1st of join month (e.g. `2026-04-01`) — used as payment date so charts show correct month
   - For non-monthly plans: `amount = fees` (flat rate, no × months)
   - Invoice ID: `db.fetchNextInvoiceNum()` → scans all INV-YYYY-NNN, picks max+1
7. **Immediate suspend check**: if `paidTill` already expired by 3+ days → suspend immediately

---

## 2. Fee Plan Logic

| Plan | `fees` field means | `paidTill` advances | `monthsCovered` |
|------|--------------------|---------------------|-----------------|
| Monthly | per-month rate | +1 month | 1 |
| Quarterly | flat quarterly total | +3 months | 3 |
| Yearly | flat yearly total | +12 months | 12 |

`calcHistoricalPayment` rule: `amount = fees × months` only for monthly. For quarterly/yearly: `amount = fees` (flat).

---

## 3. Record Payment Flow (`AppContext.addPayment`)

1. User selects student, enters amount, picks **Payment Date** (default = today)
2. `paymentType` auto-switches to student's `feePlan`
3. `baseDate = paymentDate` (from modal date picker)
4. `paidTill = last day of (baseDate.month + planMonths)`
5. `monthLabel` generated from baseDate
6. Invoice ID: `db.fetchNextInvoiceNum()`
7. INSERT payment row with `date = payDate`
8. If student was Suspended → `db.activateStudentWithBatch(...)` → moves to Active
9. If student was Active → `db.updateStudentPaidTill(...)` updates `paid_till` in DB

---

## 4. Invoice ID Generation

Old (buggy): `INV-{year}-{count+1}` — collides when payments are deleted.

New: `db.fetchNextInvoiceNum()` — scans all existing `INV-YYYY-NNN` IDs, extracts the max NNN, returns `max+1`. Never collides.

---

## 5. Student Code Generation

Old (buggy): `SA{count+1}` — collides when students are deleted.

New: `db.fetchNextStudentCode()` — queries `ORDER BY student_code DESC LIMIT 1`, extracts max number, returns `SA(max+1)`.

---

## 6. Overdue & Suspension Rules

| State | Trigger |
|-------|---------|
| **Overdue badge** | `paidTill < today` (immediate, same day paidTill expires) |
| **Auto-suspend on load** | `today - paidTill >= 3 days` (runs every app load) |
| **Suspend on add** | Same 3-day rule — new student immediately suspended if already 3+ days overdue |
| **Reactivate button** | Visible on Suspended tab when `paidTill >= today` (already paid for current period) |

Auto-suspend is wrapped in try/catch — any DB error shows a red toast instead of failing silently.

---

## 7. Paid Till Storage

- **Form input**: `type="month"` → value is `YYYY-MM`
- **DB storage**: `DATE` column → `YYYY-MM-DD` (last day of the month)
- **Conversion** (AppContext): `YYYY-MM` → `new Date(yr, mo, 0)` → last day of month
- **Display** (profile, table): formatted with `toLocaleDateString('en-IN')`

---

## 8. Inline Payment Date Edit (Payments page)

Hover the **Date** column on any payment row → pencil icon appears → click → date input → blur saves.

- `db.updatePaymentDate(id, date)` → UPDATE `payments SET date = ?`
- `AppContext.updatePaymentDate(id, date)` → updates local state

---

## 9. Month Filter (Payments page)

When a month is selected in the Payments page filter:
- Table rows filtered by `p.date.slice(0, 7) === monthFilter`
- **Collected** and **Overdue** summary cards also filtered to that month
- A banner "Showing: April 2026" appears under the cards
