# Per-branch tax + printable receipts — design

**Date:** 2026-08-16
**Status:** approved in chat, implementation in progress

## Goal

1. Each branch decides whether it charges tax, at its own rate, independently for
   monthly fees / trial fee / kit fee.
2. Tax is visible on the `/join` fee section before the parent commits.
3. After an online payment *or* a walk-in ("Pay at the academy") submission, the
   registrant can print/save a receipt carrying the academy's name, branch,
   address and GSTIN.

## Core invariant

**`payments.amount` and `trials.trial_fee_amount` remain the gross figure the
payer actually hands over.** Tax is recorded *beside* the total, never added on
top of a stored one:

```
base = amount − tax_amount
```

Every existing report sums `amount`. If tax were stored additively, all
historical revenue figures would silently change meaning. With this rule, rows
written before this feature (tax columns NULL) print and sum exactly as today.

## Data model — migration `0154`

`0152` is already used by two files (`0152_academy_contact_profile.sql` and
`0152_student_medical_and_relationship.sql`). Numbering continues at 0154; the
existing collision is left alone.

### `sport_branches` — four new columns

| Column | Type | Meaning |
|---|---|---|
| `tax_percent`  | `numeric(5,2)` | the branch's own rate |
| `tax_on_fees`  | `boolean NOT NULL DEFAULT false` | apply to monthly fees |
| `tax_on_trial` | `boolean NOT NULL DEFAULT false` | apply to trial fee |
| `tax_on_kit`   | `boolean NOT NULL DEFAULT false` | apply to kit fee |

All default to off, so every existing branch behaves identically until an owner
opts in. A NULL or zero `tax_percent` means no tax regardless of the toggles.

### `payments`, `trials` — breakdown columns

`tax_percent numeric(5,2)`, `tax_amount numeric` — both nullable. NULL means
"predates tax" and suppresses the tax row on the receipt.

### RPC changes

Verified live via `pg_get_function_arguments` before writing any DROP — this
codebase's rule, because `CREATE OR REPLACE` cannot change an argument list and
a mismatched DROP leaves a second ambiguous overload.

| RPC | Live signature | Change |
|---|---|---|
| `secure_insert_sport_branch` | `(text, text, text, text, numeric, text, numeric)` | DROP + recreate with 4 tax params appended |
| `secure_update_sport_branch` | `(uuid, text, text, bigint, text, numeric, text, numeric)` | DROP + recreate with 4 tax params appended |
| `secure_public_trial_branches_v2` | `(text)` | plain `CREATE OR REPLACE`; return the tax columns so `/join` can compute |
| `secure_submit_public_trial_v2` | 22 args | DROP + recreate with `p_tax_percent`, `p_tax_amount` appended |
| `secure_insert_payment` | `(jsonb, text)` | **no signature change** — reads new payload keys |

New params always append *after* the existing ones so current call sites keep
working.

## Tax calculator — `src/lib/tax.js`

Single source of truth, mirroring how `dates.js` and `studentRules.js` own their
domain. Rounds to whole rupees: Razorpay bills in integer paise, and fractional
rupees cause reconciliation drift.

```js
computeTax(base, pct) → { base, taxPct, taxAmount, total }
resolveBranchTax(branch, bucket) → pct   // bucket: 'fees' | 'trial' | 'kit'
```

`resolveBranchTax` returns 0 unless `tax_percent > 0` **and** the matching
toggle is on, so the toggle logic lives in exactly one place.

## Monthly fees — how tax lands on a multi-month payment

The period never enters the calculation. Tax is applied **once, to the final
payable amount**, whether that covers half a month or a year:

```
subtotal    = fee × months          (monthly/custom) or flat amount (quarterly/yearly)
discountAmt = round(subtotal × discount%)
taxableBase = subtotal − discountAmt
taxAmount   = round(taxableBase × rate%)
total       = taxableBase + taxAmount + lateFee
```

**Rounded once, at the end — never per month.** On a ₹833 fee, taxing each
month and summing gives 12 × round(149.94) = ₹1800, while taxing the year gives
round(1799.28) = ₹1799. Per-month rounding drifts across a year and the
receipt's line items stop summing to its own total.

Decisions (confirmed 2026-08-16):

- **Tax follows the discount** — charged on what is actually paid.
- **The late fee is not taxed.** It is a penalty, not consideration for
  coaching, so it is added *after* tax.
- **A manual amount override is the FINAL total**, not a base. Staff type what
  they collect, so the tax is backed out of it:
  `base = round((override − lateFee) / (1 + rate/100))`, `tax = override − lateFee − base`.
  Exact by construction, so base + tax + lateFee always equals the typed figure.
- **Trial-fee credit is deducted before tax**, so a trial fee already taxed at
  registration is not taxed a second time on conversion.

## Money path — Razorpay edge functions

`razorpay-create-trial-order/index.ts:117` computes the charge server-side:

```ts
const amount = Number(branch.trial_fee ?? 590) + Number(branch.kit_fee ?? 0)
```

Its header states the amount is "never a client-supplied number" — deliberate,
and it stays that way. The function must apply the branch's tax itself, or the
page would display ₹696 while the card is charged ₹590. Same for
`razorpay-create-order` (monthly fees).

**These require a separate `supabase functions deploy` — they do not ship with a
git push.**

## UI

1. **`SportSelect.jsx` branch editor** — Tax % field plus three checkboxes,
   beside the existing Trial Fee / Kit Fee inputs.
2. **`/join` section 05** — line items with a GST row naming its own base, e.g.
   `GST @ 18% (on trial fee)`, so a parent cannot read it as tax on the whole
   subtotal. Sticky footer total follows.
3. **`Payments.jsx`** add-payment modal — base / tax / total shown and stored.
4. **`src/lib/receipt.js`** — `buildReceiptHTML` lifted out of `Payments.jsx`
   (page-local today) to sit with `performancePDF.js` / `sessionPDF.js`. Gains
   academy address, city, state, GSTIN, contact phone/email — all already stored
   on `academies` by Settings, and all currently unprinted despite
   `0152_academy_contact_profile.sql` claiming GSTIN is "printed on fee receipts
   when set". Gains a tax row in the totals box.
5. **`/join` success screen** — Download receipt. One template, two states:
   online-paid prints **Receipt** / PAID; walk-in prints **Registration Slip** /
   PAYMENT PENDING with the amount due on arrival.

## Order of work

1. Migration + `lib/tax.js` + branch Tax fields
2. `/join` breakdown + edge-function amount + trial slip/receipt
3. Receipt template upgrade (address / GSTIN / tax), shared by both
4. Monthly fees in `Payments.jsx`

Step 4 is last because it touches live revenue records.

## To verify during implementation

Whether `studentRules.js` or the `daily-overdue-check` function compare a
student's `fees` against payment `amount` to decide overdue status. If they do,
taxed amounts would shift who reads as overdue, and the comparison must use the
base rather than the gross.

## Testing

This repo has no test suite (`tests/` does not exist despite the npm scripts).
Verification is manual: parse-check with esbuild, then walk `/join` end to end
with a taxed and an untaxed branch, and confirm the Razorpay order amount in the
dashboard matches the displayed total before enabling tax on a live branch.
