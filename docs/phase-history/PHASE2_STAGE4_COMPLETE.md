# Phase 2 — Stage 4 Completion Record

**Date:** 2026-05-20
**Status:** ✅ Migration + JS written. **NOT yet applied. Not committed.**

---

## What Stage 4 does

Closes the DevTools-bypass hole for payment fabrication.

**Before:** Even with the secure RPC from Stage 3, a coach could still bypass it:
```js
await supabase.from('payments').insert({ student_id: 5, amount: 5000, status: 'Paid' })
// ✅ Succeeded — payments_anon_insert from migration 0034 allowed it
```

**After Stage 4:**
```js
await supabase.from('payments').insert({ ... })
// ❌ Returns 0 rows inserted — RLS silently blocks
```

The only path that still writes to `payments` is `secure_insert_payment` (SECURITY DEFINER bypasses RLS) and `create_student_with_payment` (also SECURITY DEFINER).

---

## Files changed (uncommitted)

```
supabase/migrations/0036_lock_anon_payment_insert.sql    (new)
src/lib/db.js                                             (status passthrough)
src/lib/exportImport.js                                   (routes through RPC)
PHASE2_STAGE4_COMPLETE.md                                 (this file)
```

---

## Pre-checks done before this migration

1. ✅ All raw `.from('payments').insert(` calls in `src/` migrated to use `db.insertPayment` (which uses the RPC)
2. ✅ `create_student_with_payment` is `SECURITY DEFINER` (confirmed via `0005_transactional_rpcs.sql:64`) — unaffected by RLS changes
3. ✅ `insertPayment` extended to accept optional `status` so import path can preserve "Unpaid" entries

---

## Action required from you

1. **Apply migration 0036** in Supabase SQL Editor
2. **Smoke test these 3 payment-write flows:**
   - Owner adds a payment via Payments page → should succeed via RPC
   - Owner adds a student via Add Student (which calls `createStudentWithPayment` with an initial payment) → should succeed via SECURITY DEFINER
   - Owner imports a sport backup that contains payments → should succeed via RPC

---

## The actual security proof

In Supabase SQL Editor, switch the role dropdown to **`anon`** and run:

```sql
INSERT INTO payments (id, student_id, student, amount, status)
VALUES ('TEST-FRAUD', 1, 'fake', 99999, 'Paid');
-- Expected: 0 rows inserted (RLS silently blocked)
```

Then check no row appeared:
```sql
SELECT * FROM payments WHERE id = 'TEST-FRAUD';
-- Expected: no rows
```

Switch role back to `postgres` after.

---

## Verification after applying

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'payments' AND 'anon' = ANY(roles)
ORDER BY cmd;
-- Expect 2 rows: payments_anon_select (SELECT), payments_anon_update (UPDATE)
-- NO payments_anon_insert
```

---

## What's still open (next stages)

| Op | Status |
|----|--------|
| Payment INSERT via anon | ✅ blocked (this stage) |
| Payment DELETE via anon | ✅ blocked (Stage 2 — migration 0034) |
| Payment UPDATE via anon | ❌ still open (future stage) |
| Student status UPDATE via anon | ❌ still open |
| Attendance INSERT via anon | ❌ still open |
| Most other tables | ❌ still wide-open via anon_all |

Payment UPDATE is the next-highest priority — a coach can still flip "Unpaid" → "Paid" on any payment via DevTools. That requires a `secure_update_payment_status` RPC + drop anon UPDATE on payments.

---

## Rollback

```sql
-- Restore the wide-open anon INSERT policy
CREATE POLICY payments_anon_insert ON public.payments
  FOR INSERT TO anon WITH CHECK (true);
```

JS rollback if `insertPayment` breaks somehow:
```bash
git checkout src/lib/db.js src/lib/exportImport.js
```

---

## Filename collision note (housekeeping)

Two migrations share the `0031` prefix:
- `0031_phase0_hardening.sql` (Phase 0 work)
- `0031_students_anon_write.sql` (pre-existing)

Both already applied in prod. Migration apply order is alphabetical so the `phase0_hardening` runs first by filename, but the collision is fragile. Optional follow-up: rename one to `0031a_` and `0031b_` for clarity. Not blocking anything right now.

---

## Suggested commit message (when ready)

```
fix: phase 2 stage 4 — drop anon INSERT on payments

Migration 0036 removes payments_anon_insert. After this, the only
paths that can write to the payments table are:
- secure_insert_payment RPC (validates caller + academy)
- create_student_with_payment RPC (SECURITY DEFINER, atomic enrollment)

JS side:
- exportImport.js now routes through db.insertPayment instead of a
  raw .from('payments').insert(). Required for import to keep
  working after the lockdown.
- insertPayment accepts optional status so import can preserve
  "Unpaid" entries rather than coercing everything to "Paid".

Closes the payment-fabrication DevTools-bypass for anon callers.
```
