# SportFlow CRM — Payment System

## How Payments Are Stored

Every payment is a row in the `payments` table with a unique invoice ID (`INV-{year}-{seq}`).

The `payments` table is append-only for real payments. Overdue rows on the UI are **virtual** — computed in memory, not stored.

---

## Recording a Payment (`addPayment` in AppContext)

Inputs from `RecordPaymentModal`:
- `studentId`, `amount`, `paymentType` (`monthly`/`quarterly`/`yearly`), `monthsCovered`, `paymentDate` (default today, max today), `mode` (`UPI`/`Cash`/`Bank Transfer`), `baseAmount`

**What happens:**
1. Compute `paidTill` = last day of month N months from `paymentDate`
2. Compute month label (e.g. `May 2026` or `May–Jul 2026`)
3. `db.fetchNextInvoiceNum()` → next sequential number across all payments
4. `db.insertPayment(paymentRow, invoiceId)` → writes to DB
5. **If student is Suspended** → auto-reactivate (see student lifecycle doc)
6. **If student is Active** → `db.updateStudentPaidTill(studentId, paidTill, baseAmount)`
7. Prepends new payment to local `payments` array

---

## Fee Plan Impact on Payment Recording

| Plan | `monthsCovered` | Amount entered | Amount stored | `paidTill` |
|---|---|---|---|---|
| Monthly | 1 | per-month rate | same | +1 month |
| Quarterly | 3 | flat quarterly total | same (no × 3) | +3 months |
| Yearly | 12 | flat yearly total | same (no × 12) | +12 months |

`RecordPaymentModal` auto-switches the plan label when a student is selected based on their `feePlan` field.

---

## Deleting a Payment (`removePayment`)

1. `db.deletePayment(id)` → removes from DB
2. Recomputes `paidTill` from remaining payments:
   - Finds the most recent prior `Paid` payment for the same student
   - Re-derives `paidTill = date + monthsCovered months`
   - If no prior payments → `paidTill = null`
3. `db.updateStudentPaidTill(studentId, newPaidTill, null)`
4. Updates local state

---

## Overdue Detection (Virtual Rows)

Computed in `Payments.jsx` `overdueRows` useMemo — never stored in DB.

**Criteria for a virtual overdue row:**
- Student `status` is `Active` OR `Suspended`
- `paidTill` is not null
- `paidTill < first day of current month`
- No existing `Pending` or `Overdue` payment record in DB for that student

**Virtual row shape:**
```js
{
  id:          'DUE-{studentId}',  // fake ID
  studentId:   s.id,
  student:     s.name,
  amount:      s.fees,
  month:       'Due — paid till {date}',
  date:        null,
  status:      'Overdue',
  isVirtual:   true,
  isSuspended: s.status === 'Suspended',
}
```

Clicking "Record Payment" on a virtual row opens `RecordPaymentModal` pre-filled with that student.

---

## Inline Date Editing

Hover any payment row's Date column → pencil icon appears → click → date input.
On blur → `db.updatePaymentDate(id, date)` + local state update.

---

## Revenue Chart (Payments Page)

Shows last 8 months of real collected revenue.
- Only `status = 'Paid'` payments
- Grouped by `payment.date` (not month label)
- Uses Recharts `BarChart`

---

## Month Filter (Payments Page)

Filters both the table rows AND the summary cards (Collected / Overdue) by payment date.
Default: current month (`YYYY-MM` format).

---

## calcHistoricalPayment (AppContext)

Used when adding/editing a student with a `paidTill` date — computes what the auto-created payment record should look like.

```
Input:  joinDate, paidTill, fees, feePlan
Output: { monthsCovered, label, amount, startDate }
```

- `startDate` = 1st of `joinDate`'s month (NOT today) — used as the payment's `date`
- `label` = `May 2026` (single month) or `Oct 2025–Oct 2026` (multi-month)
- `amount` = `fees × months` for monthly, `fees` flat for quarterly/yearly

---

## Payment Statuses

| Status | Meaning |
|---|---|
| `Paid` | Confirmed payment with date + mode |
| `Pending` | Created but not yet collected |
| `Overdue` | Past due (real DB row or virtual computed row) |

---

## Invoice ID Format

`INV-{year}-{seq}` where `seq` is a zero-padded 3-digit integer, e.g. `INV-2026-001`.

`fetchNextInvoiceNum()` scans all payment IDs and returns `maxNum + 1`.

---

## Excel Export

Payments page has a Download button that exports the filtered payment rows as an `.xlsx` file using the `xlsx` library.
