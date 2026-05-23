# security-v3 — Branch & Sport Isolation

Sibling folder to `supabase/migrations/`. Kept separate so the 88-file migration history
stays untouched and the audit work is reviewable as one unit.

## Status

| Phase | Goal | Files |
|---|---|---|
| Phase 1 (this folder, applied incrementally) | Branch enforcement on all secure_* write RPCs. Owners + branch-less staff unrestricted. Branch-scoped staff cannot write to other branches. | `01_actor_branch_helper.sql`, `02_branch_writes_core.sql`, `03_branch_writes_extended.sql` |
| Phase 2 (future) | Login flows moved to RPCs, so anon SELECT can be locked down. | TBD |
| Phase 3 (future) | Lock anon SELECT (replace `USING (true)` with scoped predicates). | TBD |

## How to apply

```
node scripts/db-fast.mjs apply-dir supabase/security-v3
```

This connects once to the Tokyo pooler and applies every `.sql` file in numeric order.
Rollback files (`*_rollback.sql`) are stored alongside but are not auto-applied.

## What Phase 1 changes — concretely

1. `current_actor(p_token)` is dropped and recreated with one additional column,
   `branch_id UUID`. Existing callers that do `SELECT * INTO a FROM current_actor(...)`
   keep working — they now also get `a.branch_id` available.
2. Helper `_require_branch_scope(actor_kind, actor_branch, target_branch)` raises
   `42501 'forbidden: cross-branch'` if a branch-scoped staff tries to act on a row
   from another branch. Owners + NULL-branch staff bypass.
3. Every branch-scopable secure_* write RPC gains a branch check after its existing
   academy check. For inserts that take a `branch_id` parameter (batches, announcements,
   trials), if the caller is branch-scoped the param is overridden to their own branch.

## What Phase 1 does NOT change

- Read-side policies (still wide-open anon SELECT — that's Phase 3).
- RPC signatures (no client changes needed).
- Existing data (no UPDATE/DELETE on existing rows).
- Owner / office-staff behavior (both remain academy-wide).
