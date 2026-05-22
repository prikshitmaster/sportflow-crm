# Restore Runbook

How to restore a SportFlow database from a `pg_dump` archive produced by the
`db-backup` GitHub Action.

## Quick reference

| Scenario | Action |
|---|---|
| Tested rollback drill (quarterly) | Restore to a fresh Supabase project, run smoke tests |
| Disaster recovery (prod down) | Restore latest dump to a new Supabase project, repoint app `VITE_SUPABASE_URL` |
| Single-table recovery | Restore to a sandbox, copy specific tables via `pg_dump --table=...` + `psql` |

## Prerequisites

- A Postgres 16 client (`pg_restore`, `psql`) installed locally
- The `.dump` file from a recent GitHub Actions run (Actions → DB Backup → Artifacts)
- A target Postgres connection string (a *fresh* DB — never restore over prod without staging first)

## Step 1 — Download the backup

```bash
gh run download <run-id> --name sportflow-db-<stamp>
# or via the GitHub web UI → Actions → DB Backup → Artifacts
```

## Step 2 — Restore to a target DB

```bash
# Replace TARGET_DB_URL with the destination (a NEW Supabase project, ideally).
TARGET_DB_URL="postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"

pg_restore \
  --dbname="$TARGET_DB_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --verbose \
  sportflow-YYYYMMDD-HHMM.dump
```

Flags:
- `--clean --if-exists` drops existing objects first — safe on a fresh DB, **destructive** if you point this at prod
- `--no-owner --no-acl` strips Supabase-managed roles; they'll be re-attached on next migration run

## Step 3 — Re-grant RPC execute permissions

After restore, re-run all `secure_*` GRANTs to make sure anon/authenticated can call the RPCs:

```bash
psql "$TARGET_DB_URL" -c "GRANT USAGE ON SCHEMA public TO anon, authenticated;"
psql "$TARGET_DB_URL" -c "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;"
```

## Step 4 — Verify

Run these queries to confirm key tables came back intact:

```sql
SELECT count(*) FROM academies;
SELECT count(*) FROM students;
SELECT count(*) FROM payments WHERE status = 'Paid';
SELECT count(*) FROM staff WHERE status = 'Active';
SELECT max(date) FROM payments;  -- should match the dump timestamp
```

## Step 5 — Point the app at the restored DB (only for full DR)

In Vercel / `.env`:
```
VITE_SUPABASE_URL=https://<new-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<new-anon-key>
```

Redeploy. Existing user sessions will be invalid (different JWT signing key) —
users will need to log in again.

## RTO / RPO targets

| Metric | Target | Notes |
|---|---|---|
| Backup frequency | 24h | GitHub Actions cron at 02:00 UTC |
| RPO (data loss window) | ≤ 24h | Worst case: outage right before next backup |
| RTO (recovery time) | ≤ 2h | Pull dump → restore to new project → repoint app |
| Backup retention | 30 days | GitHub Artifacts; extend via S3 for longer |

To improve RPO below 24h, enable Supabase PITR on the production project
(Settings → Database → Point-in-Time Recovery) — supports any second within
the retention window.

## Quarterly drill checklist

- [ ] Spin up a sandbox Supabase project
- [ ] Restore latest dump (this runbook)
- [ ] Run smoke queries (Step 4)
- [ ] Verify a known student / payment / batch is present and unchanged
- [ ] Delete the sandbox project
- [ ] Record drill outcome in `docs/backup-drills.md` (date, RTO observed, issues)
