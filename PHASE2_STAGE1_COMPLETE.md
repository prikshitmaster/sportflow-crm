# Phase 2 — Stage 1 Completion Record

**Date:** 2026-05-20
**Status:** ✅ Code + migration written. **Migration NOT yet applied. Not committed.**

---

## What Stage 1 does

Adds SECURITY DEFINER RPCs that gate 4 destructive deletes behind token validation. The app keeps working unchanged — Stage 1 is purely additive. The actual security gain comes in Stage 2 when we remove anon DELETE from those tables.

| Op | Old path | New path | Gate |
|----|----------|----------|------|
| `deleteStudent` | `.from('students').delete()` x3 | `secure_delete_student(id, token)` | Owner OR staff with `students.manage` |
| `deletePayment` | `.from('payments').delete()` | `secure_delete_payment(id, token)` | Owner OR staff with `payments.manage` |
| `deleteBatch` | `.from('batches').delete()` | `secure_delete_batch(id, token)` | Owner OR staff with `batches.manage` |
| `deleteStaff` | `.from('staff').delete()` x3 | `secure_delete_staff(id, token)` | **Owner only** |

All RPCs verify the row's `academy_id` matches the caller's academy before deleting. Cross-tenant deletes return `42501 forbidden`.

---

## Files changed (uncommitted)

```
supabase/migrations/0033_secure_delete_rpcs.sql    (new)
src/lib/db.js                                       (5 edits — helper + 4 functions)
PHASE2_STAGE1_COMPLETE.md                           (this file)
```

---

## How authentication resolves inside the RPCs

`current_actor(p_token)` returns one row:

1. **If `auth.uid()` is set** (Supabase Auth path → owner): returns `('owner', NULL, profiles.academy_id, NULL)`
2. **Else if `p_token` matches a valid `staff_sessions.token`**: returns `('staff', staff.id, staff.academy_id, staff_auth.permissions)`
3. **Else if `p_token` matches a valid `student_sessions.token`**: returns `('student', student.id, student.academy_id, NULL)`
4. **Else**: returns no rows → RPC raises `authentication required`

The JS helper `_sessionToken()` reads `localStorage.sf_staff` then `localStorage.sf_student` and passes whichever exists. For an owner, both keys are empty so `null` is passed — `auth.uid()` then carries the auth signal.

---

## Action required from you

**Apply migration 0033 in Supabase SQL Editor.** It's idempotent — safe even if you re-run.

```bash
# Or open Supabase Studio → SQL Editor → paste contents of:
supabase/migrations/0033_secure_delete_rpcs.sql
```

After applying, **smoke test these 4 flows** (each should still work as before):

1. **Owner deletes a student** — Students page → trash icon on a test student → confirm
2. **Owner deletes a payment** — Payments page → delete a payment
3. **Owner deletes a batch** — Batches page → delete an empty test batch
4. **Owner deletes a staff member** — Settings/Staff → remove a test staff

If any of these throw `function does not exist` → the migration didn't apply. Re-run.
If any throw `authentication required` → token resolution is broken. Stop and investigate.

---

## What Stage 1 does NOT yet protect against

**Today, a coach/student with DevTools open can still bypass the RPC** by calling the raw delete:

```js
// Still works because anon_all policy from migration 0032 is wide open:
await supabase.from('students').delete().eq('id', 5)
```

Stage 2 closes this hole by removing the anon DELETE permission on these 4 tables.

---

## Stage 2 plan (next session)

```sql
-- Migration 0034 — close the DevTools-bypass hole
-- Drops the anon DELETE on the 4 protected tables.
-- After this, ONLY secure_delete_* RPCs can delete rows.

DROP POLICY IF EXISTS students_anon_all ON students;
CREATE POLICY students_anon_rw ON students
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
-- Then split into anon_select/anon_insert/anon_update without anon_delete
-- ...same for payments, batches, staff
```

**Pre-check before applying Stage 2** — grep for any `.from('students').delete(`, `.from('payments').delete(`, `.from('batches').delete(`, `.from('staff').delete(` outside of these wrapper functions. As of Stage 1, only the wrappers call these. If new code reintroduces a raw delete, Stage 2 silently breaks it.

---

## Rollback if Stage 1 breaks something

**JS rollback:**
```bash
git checkout src/lib/db.js
```
Reverts to Phase 1 state. The migration can stay in place — the RPCs are unused if JS doesn't call them.

**SQL rollback (extreme):**
```sql
DROP FUNCTION IF EXISTS secure_delete_student(BIGINT, TEXT);
DROP FUNCTION IF EXISTS secure_delete_payment(TEXT, TEXT);
DROP FUNCTION IF EXISTS secure_delete_batch(BIGINT, TEXT);
DROP FUNCTION IF EXISTS secure_delete_staff(BIGINT, TEXT);
DROP FUNCTION IF EXISTS _require_perm(TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS current_actor(TEXT);
```

---

## Notes on payments.id type

I used `p_payment_id TEXT` in `secure_delete_payment` because `payments.id` is the human-readable invoice string like `INV-2026-144`, not a numeric PK. Confirm this in the DB before applying:

```sql
SELECT pg_typeof(id) FROM payments LIMIT 1;
```

If it shows `bigint` instead of `text`, change the RPC signature to `p_payment_id BIGINT` and re-apply.

---

## Suggested commit message (when ready)

```
fix: phase 2 stage 1 — secure delete RPCs

Routes deleteStudent, deletePayment, deleteBatch, deleteStaff through
SECURITY DEFINER Postgres functions that validate the caller's identity
(owner JWT or staff/student session token), check permissions, and
enforce same-academy scoping server-side.

Stage 1 is additive — the underlying tables still allow anon DELETE,
so this commit alone does not yet block DevTools-bypass attacks.
Stage 2 will remove anon DELETE from these 4 tables.
```
