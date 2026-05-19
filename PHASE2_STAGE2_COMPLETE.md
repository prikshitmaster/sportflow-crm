# Phase 2 — Stage 2 Completion Record

**Date:** 2026-05-20
**Status:** ✅ Migration applied + verified in app. **Not committed.**

**Verification done:**
- pg_policies query → 12 rows, SELECT/INSERT/UPDATE only, no DELETE for anon
- 4 owner-side delete flows in UI all working (RPC path intact)

---

## What Stage 2 does

Closes the DevTools-bypass hole. After applying this migration, the **only** way to DELETE from `students`, `payments`, `batches`, or `staff` is through the `secure_delete_*` RPCs from Stage 1.

| Table | Before (0032) | After (0034) |
|-------|---------------|--------------|
| students | anon SELECT/INSERT/UPDATE/**DELETE** all allowed | anon SELECT/INSERT/UPDATE only |
| payments | same | same |
| batches | same | same |
| staff | same | same |

---

## Files changed (uncommitted)

```
supabase/migrations/0034_lock_anon_delete.sql    (new)
PHASE2_STAGE2_COMPLETE.md                         (this file)
```

No JS changes — Stage 2 is pure SQL.

---

## How the security gain works

**Before Stage 2** — coach opens DevTools:
```js
await supabase.from('students').delete().eq('id', 5)
// ✅ Succeeds. anon_all policy allows DELETE.
// → Coach wipes a student against the owner's wishes.
```

**After Stage 2** — same attack:
```js
await supabase.from('students').delete().eq('id', 5)
// ❌ Returns { error: null, data: null, count: 0 } — RLS silently filters out
// the row because no DELETE policy applies to anon. The student is NOT deleted.
```

The app's legitimate `deleteStudent(id)` still works because it routes through
`secure_delete_student` (a SECURITY DEFINER function that bypasses RLS, validates
the caller, and performs the delete server-side).

---

## Action required from you

**Apply migration 0034 in Supabase SQL Editor.** Idempotent — safe to re-run.

---

## Verification after applying

### 1. Confirm policies look right
```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('students','payments','batches','staff')
  AND 'anon' = ANY(roles)
ORDER BY tablename, cmd;
```

Expected: 3 policies per table (SELECT, INSERT, UPDATE) — total 12 rows. **No DELETE entries.**

### 2. Test the actual security gain (the whole point of this migration)

In Supabase SQL Editor, **switch the role to `anon`** at the top of the editor (Role dropdown):

```sql
-- Set role to anon, then run:
DELETE FROM students WHERE id = 999999;
-- Expected: "DELETE 0" (no error, but no rows deleted either)
-- This confirms RLS blocked the delete silently.
```

Switch role back to `postgres` after.

### 3. UI smoke test — same as Stage 1

The 4 delete flows in the app must still work (because they go through the RPC, not the raw DELETE):

1. Owner deletes a test student → ✅
2. Owner deletes a payment → ✅
3. Owner deletes a batch → ✅
4. Owner deletes a staff → ✅

If any of these now fail with `permission denied for relation X` or similar, it means a code path I missed is still doing a raw `.from('X').delete()` somewhere. Paste the error and I'll find it.

---

## Rollback if anything breaks

```sql
-- Restore the wide-open anon policy
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['students','payments','batches','staff'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
      t || '_anon_all', t
    );
  END LOOP;
END $$;
```

This restores migration 0032's behavior. The Stage 1 RPCs still work (they bypass RLS anyway).

---

## Where we are now (Phase 2 overall)

| Stage | What | Status |
|-------|------|--------|
| 1 | Add `secure_delete_*` RPCs + route db.js through them | ✅ Applied + tested |
| 2 | Drop anon DELETE on 4 protected tables | ⏳ Written, pending apply |
| 3 (future) | Extend pattern to INSERT/UPDATE for sensitive ops | ☐ Not started |

After Stage 2 lands, the **destructive-write attack surface for anon-keyed users is closed** on the 4 highest-risk tables. Reads remain wide-open (which is the next big security frontier — but tightening reads requires the full token-validation-in-RLS work, the hardest part).

---

## What Stage 2 does NOT yet protect

- **Anon SELECT** of any table → cross-academy data theft via DevTools still possible
- **Anon UPDATE** of any table → a coach could still mark a student "Active" who was suspended
- **Anon INSERT** of any table → a coach could still create fake payments
- **Authenticated DELETE** on these tables (if old policies exist) → owners could DevTools-bypass the RPC

Closing those needs the longer-term RLS rework (the "Option A" path from earlier). For now, Stage 2 buys you DevTools-bypass protection on the highest-impact ops.

---

## Suggested commit message (when ready)

```
fix: phase 2 stage 2 — block anon DELETE on protected tables

Replaces the wide-open anon_all policy on students/payments/batches/staff
with three narrower SELECT/INSERT/UPDATE policies. Anon DELETE is now
blocked by RLS — destructive ops must go through the secure_delete_*
RPCs from migration 0033, which validate the caller and academy scope.

Closes the DevTools-bypass hole where a coach or student with the
shipped anon key could call .from('students').delete() directly.
```
