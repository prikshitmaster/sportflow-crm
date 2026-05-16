# Supabase migrations — apply order

These migrations close the **CRITICAL** findings in `AUDIT.md` (C1–C5,
M2-bis). They are **manual** by design — Claude did not auto-apply them
because each one needs verification against your live data.

Apply in order. Verify each step before continuing.

| # | File | What it does | Safe to apply alone? |
|---|------|--------------|----------------------|
| 1 | `0001_indexes.sql` | Adds missing indexes on `academy_id`, FK columns, hot filters | Yes — zero risk, additive only |
| 2 | `0002_backfill_academy_id.sql` | Backfills NULL `academy_id` on existing rows | Yes — only writes to NULL rows |
| 3 | `0003_tighten_owner_rls.sql` | Replaces `USING (true)` with `academy_id = get_my_academy_id()` for owner JWT path | **Verify owner login works** before continuing |
| 4 | `0004_session_header_rls.sql` | Tightens staff/student anon policies using session-token header | **Apply only after Phase D app changes are deployed** |

## How to apply (Supabase dashboard)

1. Open Supabase → SQL Editor → New Query.
2. Paste the file contents.
3. Hit **Run**.
4. Test the listed verification queries.
5. Only then move to the next file.

## Rollback

Each file has a `-- ROLLBACK` section at the bottom. To revert:

```sql
-- inside SQL Editor, paste the ROLLBACK block of the last applied file
```

## Why not auto-apply

If the app is connected and a strict policy is applied without backfill,
every row with `academy_id IS NULL` becomes invisible. The fix is one
SQL statement, but you need to know to run it. Manual gating prevents
silent data loss.
