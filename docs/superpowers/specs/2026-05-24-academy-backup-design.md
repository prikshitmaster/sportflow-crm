# Academy Backup & Data Safety — Design Spec

**Date:** 2026-05-24
**Status:** Approved (pending spec review)

## Goal

Give academy owners confidence to rely on the software by guaranteeing their data
(especially payments) is never lost. Two parts:

1. **Automatic safety net** — a weekly full-academy backup the system creates on
   its own, kept ~12 weeks, downloadable in-app and emailed to the owner.
2. **One-click download** — an owner button to download a full-academy Excel
   backup of live data at any moment.

## Requirements (from brainstorming)

- **Contents:** full academy backup — one `.xlsx` with a sheet per entity:
  `payments`, `students`, `batches`, `attendance`, `trials`.
- **Schedule:** weekly backup (Sunday night), weekly email.
- **Retention:** keep the **last 12 weekly backups** (~3 months) in storage; prune older.
- **Delivery:** stored in-app (Backups page) **and** emailed to the owner weekly.
- **Scope:** per-academy — each backup contains only that academy's data.
- **Access:** owner-only (both the in-app page and the email recipient).
- **Live download:** the one-click button reflects current data, not the last snapshot.

## Architecture (Option 1 — Supabase-native)

The stack is a Vite React SPA + Supabase (no Next.js/serverless backend; Vercel CLI
absent). All automation lives in Supabase.

```
pg_cron (weekly)
   └─ pg_net → invoke Edge Function `weekly-backup` (service role)
        ├─ for each academy:
        │    ├─ query payments/students/batches/attendance/trials
        │    ├─ build multi-sheet .xlsx (SheetJS in Deno)
        │    ├─ upload → Storage bucket `backups/{academy_id}/{YYYY-MM-DD}.xlsx`
        │    ├─ prune files older than the 12 most recent for that academy
        │    └─ resolve owner email (auth.users via academies.owner_id)
        │         └─ Resend → email owner a signed download link
        └─ log result

Client (owner only)
   ├─ Backups page → lists last 12 via `list_academy_backups` RPC (signed URLs)
   └─ "Download backup now" → builds full-academy .xlsx client-side (SheetJS)
```

## Components

### 1. Storage bucket `backups` (private)
- Path: `{academy_id}/{YYYY-MM-DD}.xlsx`.
- Not publicly readable. Access only via short-lived **signed URLs** generated
  server-side for the owner. No anon/staff read policy on the bucket.

### 2. Edge Function `weekly-backup` (Deno, service role)
- Iterates academies (multi-tenant correct; today only ARA exists).
- Per academy: queries the five tables scoped by `academy_id`, builds the workbook
  with `import * as XLSX from "npm:xlsx"`, uploads to the bucket.
- Prunes: lists that academy's files, deletes all but the newest 12.
- Email: looks up `academies.owner_id` → `auth.users.email`; sends via Resend with
  a signed download link (link, not attachment, to avoid size limits).
- Idempotent per day: re-running the same day overwrites that date's file.
- Never throws to the scheduler — logs per-academy failures and continues.

### 3. Schedule
- `pg_cron` weekly job (Sunday 20:00 UTC) using `pg_net.http_post` to invoke the
  function with the service-role key. (Falls back to Supabase Scheduled Functions
  if `pg_cron`/`pg_net` unavailable.)

### 4. In-app Backups page (owner-only route)
- New route, owner-only (mirrors existing owner route guards).
- Lists the last 12 backups for the owner's academy via a SECURITY DEFINER RPC
  `list_academy_backups()` that returns `{date, size, signed_url}` (signed URL TTL
  ~10 min). Owner clicks a date to download.
- "Download backup now" button → builds the full-academy `.xlsx` in the browser by
  extending the existing `exportSportData` into an academy-wide export
  (`exportAcademyData`) reusing the same column mappings.

### 5. Email (Resend)
- One-time setup: Resend account, `RESEND_API_KEY` secret in Supabase, a verified
  sender (domain or single sender). Owner address from `auth.users`.
- Weekly email: subject "Your SportFlow weekly backup", body with the signed link
  + a short "we keep your data safe" reassurance line.

## Data flow / formats

- Excel column mappings reuse the existing `exportImport.js` field names so a backup
  is also re-importable later (consistency with the current import path).
- One workbook, 5 sheets. Empty tables still get a (header-only) sheet.

## Security

- Bucket private; downloads only via signed URLs minted server-side after an
  owner check. No standing public/anon access to backup files.
- `list_academy_backups()` resolves the caller via `current_actor`/owner JWT and
  only ever lists the caller's own academy folder.
- Edge function uses the service-role key (server-side only; never shipped to client).
- Per-academy isolation: every query and storage path is keyed by `academy_id`.

## Error handling

- Per-academy try/catch in the function; one academy's failure doesn't block others.
- Failures logged (and optionally surfaced via the existing logger/Sentry path).
- Client "Download now" shows a toast on failure; never partially downloads.
- Missing owner email → skip email, still store the backup, log a warning.

## Testing

- **Edge function:** invoke manually (non-scheduled) against the ARA academy →
  confirm a `.xlsx` lands in `backups/{ara}/{today}.xlsx` with 5 correct sheets.
- **Pruning:** seed >12 dated files for an academy → run → only newest 12 remain.
- **Signed URL / RPC:** owner gets working links; a staff/anon caller gets nothing.
- **Email:** Resend test send to the owner address; link downloads the file.
- **Client export:** "Download now" produces a 5-sheet workbook matching live data.
- **Schedule:** verify the `pg_cron` entry exists and fires (manual trigger first).

## Prerequisites (owner actions)

- Create a **Resend** account, add `RESEND_API_KEY` to Supabase function secrets,
  verify a sender domain/email.
- Confirm the owner email in `auth.users` is correct.

## Out of scope (YAGNI)

- Restore/import-from-backup UI (backups are downloadable; re-import uses the
  existing import path manually).
- Configurable schedule/retention UI (fixed: weekly, 12 kept). Revisit if asked.
- Per-branch or per-staff backups (owner-level, full-academy only).
- Backing up auth credentials, audit logs, notifications, session tables.
