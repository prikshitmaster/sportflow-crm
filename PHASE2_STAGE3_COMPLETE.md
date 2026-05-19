# Phase 2 — Stage 3 Completion Record

**Date:** 2026-05-20
**Status:** ✅ Migration + JS written. **NOT yet applied. Not committed.**

---

## What Stage 3 does

Adds `secure_insert_payment` SECURITY DEFINER RPC. Routes `db.insertPayment` through it. Closes the **payment fabrication** attack:

**Before:** A coach with the anon key could do this from DevTools:
```js
await supabase.from('payments').insert({
  student_id: 5, amount: 5000, status: 'Paid', ...
})
// ✅ Succeeded — anon_all policy allows INSERT on payments.
// → Owner sees a fake payment they never received.
```

**After Stage 3** (with the migration applied, before Stage 4):
- Owner's legitimate "Add Payment" UI uses the new RPC → still works
- DevTools-bypass insert still succeeds because anon INSERT on `payments` is still open

**After Stage 4** (future — drop anon INSERT on payments):
- Only path to insert a payment is through `secure_insert_payment`
- The RPC requires `current_actor()` to resolve a valid owner JWT or staff session with `payments.manage` perm
- The RPC enforces that the payment's `academy_id` matches the actor's academy
- The RPC enforces that the referenced student is in the actor's academy
- DevTools fraud attempt fails with `forbidden`

---

## Files changed (uncommitted)

```
supabase/migrations/0035_secure_insert_payment.sql    (new)
src/lib/db.js                                          (insertPayment rewrite)
PHASE2_STAGE3_COMPLETE.md                              (this file)
```

---

## What the RPC validates

1. **Authentication** — `current_actor()` must return a row (owner JWT or staff/student session token)
2. **Permission** — actor must be owner OR staff with `payments.manage` perm
3. **Academy scope (payload)** — `academy_id` in the payload must match actor's academy (or be omitted; then stamped server-side from actor)
4. **Academy scope (student)** — the referenced `student_id` must belong to the actor's academy
5. **Payment ID required** — won't insert without a non-empty `id` (the invoice number)

Errors raised:
- `42501 authentication required` — no actor
- `42501 forbidden: missing permission payments.manage` — staff without perm
- `42501 forbidden: cross-academy insert blocked` — payload academy mismatch
- `42501 forbidden: payment references student from another academy` — student academy mismatch
- `P0002 student not found` — student_id doesn't exist
- `22023 payment id required` — missing invoice id

---

## Action required from you

1. **Apply migration 0035** in Supabase SQL Editor
2. **Test the legitimate path** — owner adds a payment via the Payments page → should succeed exactly as before
3. **(Optional) Test the auth gate** — in SQL Editor, run:
   ```sql
   SELECT secure_insert_payment(
     jsonb_build_object(
       'id', 'TEST-001',
       'studentId', 999999,
       'student', 'test',
       'amount', '100',
       'mode', 'cash'
     ),
     NULL
   );
   ```
   Expected: `ERROR 42501 authentication required` (since SQL Editor postgres role has no auth.uid and no token)

---

## Verification SQL (after apply)

```sql
-- Confirm the RPC exists
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'secure_insert_payment';
-- Expect: 1 row

-- Confirm it's grantable to anon (used by staff portal)
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'secure_insert_payment';
-- Expect: 2 rows (anon + authenticated, EXECUTE)
```

---

## What's still open (next stages)

Even after this, the following raw-SQL attack paths remain via anon INSERT/UPDATE on other tables:
- Update student status (un-suspend) via `.from('students').update(...)`
- Modify payment status from "Unpaid" to "Paid" via `.from('payments').update(...)`
- Insert fake attendance for a student via `.from('attendance').insert(...)`
- Update batch enrollment count manually
- Delete arbitrary rows from non-protected tables (trials, fee_plans, events, drills, etc.)

Each follows the same pattern: add a `secure_*` RPC, route JS through it, then drop the raw anon permission. Pick by attack risk.

---

## Stage 4 plan (future session)

```sql
-- Migration 0036 — close the payment INSERT bypass
DROP POLICY IF EXISTS payments_anon_insert ON payments;
-- After this, only secure_insert_payment can write payment rows.
```

**Pre-check before applying Stage 4:** grep `src/` for any `.from('payments').insert(` outside of `insertPayment`. As of Stage 3, only the wrapper calls this. If any code path adds a raw insert later, Stage 4 silently breaks it.

---

## Rollback if anything breaks

```bash
# JS rollback — revert db.js
git checkout src/lib/db.js
```

```sql
-- SQL rollback — drop the RPC
DROP FUNCTION IF EXISTS secure_insert_payment(JSONB, TEXT);
```

The RPC is unused if JS doesn't call it; safe to leave in place even after JS rollback.

---

## Suggested commit message (when ready)

```
fix: phase 2 stage 3 — secure payment INSERT RPC

Routes db.insertPayment through secure_insert_payment SECURITY DEFINER
function that validates the caller via current_actor (owner JWT or
staff/student session token), requires the payments.manage permission,
and enforces same-academy scoping for both the payment row and the
referenced student.

Stage 3 is additive — anon INSERT on payments still allowed at the
table level, so DevTools-bypass fraud still possible until Stage 4
drops the anon_insert policy on the payments table.
```
