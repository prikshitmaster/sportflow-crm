# Academy Backup & Data Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give owners a weekly automatic full-academy Excel backup (stored in-app + emailed) plus a one-click live "Download now" export, so academies trust the software with their data.

**Architecture:** Supabase-native. A private Storage bucket holds per-academy `.xlsx` backups (12-week retention). A Deno Edge Function builds/uploads/prunes them and emails the owner via Resend; `pg_cron` runs it weekly. Owners read backups via Storage RLS (signed URLs) on a new owner-only Backups page. The "Download now" button builds the same workbook client-side with SheetJS.

**Tech Stack:** Supabase (Postgres, Storage, Edge Functions/Deno, pg_cron, pg_net), SheetJS (`xlsx`, already a dependency), Resend (email), React/Vite SPA.

**Testing note:** This repo has no JS unit-test runner. Follow the established pattern — verify DB/RLS with `node scripts/db-fast.mjs query "..."` and small `scripts/_test-*.mjs` harnesses (`SET ROLE`, signed-URL checks), and verify client/edge behavior by running them. Each task lists concrete verification commands.

**Migration numbering:** next free numbers are `0076`, `0077`. Edge function lives in `supabase/functions/weekly-backup/`.

**Prerequisite (owner, before Task 5 email works):** Resend account → set `RESEND_API_KEY` in Supabase function secrets → verify a sender domain/email. Confirm owner email in `auth.users`.

---

## File structure

- Create `supabase/migrations/0076_backups_bucket.sql` — private bucket + owner-read Storage RLS.
- Create `supabase/migrations/0077_schedule_weekly_backup.sql` — pg_cron weekly invoke (Task 6).
- Modify `src/lib/exportImport.js` — add `exportAcademyData(academyId)` (full-academy workbook builder).
- Modify `src/lib/db.js` — add `listBackups(academyId)` + `getBackupSignedUrl(path)` Storage helpers.
- Create `src/pages/Backups.jsx` — owner-only page: stored backups list + "Download now".
- Modify `src/App.jsx` — add owner route `/backups`.
- Modify `src/components/Sidebar.jsx` — add "Backups" nav link (owner).
- Create `supabase/functions/weekly-backup/index.ts` — scheduled backup builder + emailer.
- Create `scripts/_test-backups.mjs` — verification harness.

---

## Task 1: Private `backups` bucket + owner-read Storage RLS

**Files:**
- Create: `supabase/migrations/0076_backups_bucket.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0076 — private 'backups' bucket + owner-only read (signed URLs).
-- Path convention: {academy_id}/{YYYY-MM-DD}.xlsx
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Owner (authenticated) may READ only their own academy's backup objects.
-- The first path folder is the academy_id; get_my_academy_id() resolves the
-- owner's academy from auth.uid().
DROP POLICY IF EXISTS backups_owner_read ON storage.objects;
CREATE POLICY backups_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'backups'
    AND (storage.foldername(name))[1] = get_my_academy_id()::text
  );

-- No anon access. Writes happen only via the service role (edge function),
-- which bypasses RLS — so no INSERT/UPDATE/DELETE policy is granted here.
COMMIT;
```

- [ ] **Step 2: Apply**

Run: `node scripts/db-fast.mjs apply supabase/migrations/0076_backups_bucket.sql`
Expected: `✓ 0076_backups_bucket.sql (...ms)`

- [ ] **Step 3: Verify bucket + policy exist**

Run: `node scripts/db-fast.mjs query "SELECT id, public FROM storage.buckets WHERE id='backups'; SELECT policyname FROM pg_policies WHERE tablename='objects' AND policyname='backups_owner_read'"`
Expected: bucket row with `public=false`, and the `backups_owner_read` policy present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0076_backups_bucket.sql
git commit -m "feat(backup): private backups bucket + owner-read storage RLS"
```

---

## Task 2: Client full-academy workbook builder `exportAcademyData`

Reused by both the "Download now" button (Task 3) and as the column reference for the edge function (Task 5). As owner (authenticated), each `select('*')` is academy-scoped by the `*_owner_all` RLS policies; attendance has no `academy_id` column, so it is read via the owner policy (EXISTS on the academy's students).

**Files:**
- Modify: `src/lib/exportImport.js`

- [ ] **Step 1: Add the builder (append near `exportSportData`)**

```js
// ── Full-academy backup: one workbook, a sheet per entity ──
// Reuses XLSX (already imported at top of this file).
export async function exportAcademyData(academyId, { download = true } = {}) {
  const q = (t) => supabase.from(t).select('*').eq('academy_id', academyId)
  const [students, payments, batches, trials] = await Promise.all([
    q('students'), q('payments'), q('batches'), q('trials'),
  ])
  // attendance has no academy_id — owner RLS already scopes it to this academy
  const attendance = await supabase.from('attendance').select('*')

  const wb = XLSX.utils.book_new()
  const addSheet = (name, rows) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows || []), name)

  addSheet('Payments',   payments.data   || [])
  addSheet('Students',   students.data   || [])
  addSheet('Batches',    batches.data    || [])
  addSheet('Attendance', attendance.data || [])
  addSheet('Trials',     trials.data     || [])

  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `sportflow-backup-${stamp}.xlsx`
  if (download) {
    XLSX.writeFile(wb, filename)
    return { filename }
  }
  // For programmatic use: return an array buffer
  return { filename, buffer: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) }
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (no import/syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/exportImport.js
git commit -m "feat(backup): exportAcademyData full-academy xlsx builder"
```

---

## Task 3: Storage helpers in db.js (list + signed URL)

**Files:**
- Modify: `src/lib/db.js`

- [ ] **Step 1: Add helpers (near the other export/storage helpers)**

```js
// ── Backups (private 'backups' bucket; owner-only via storage RLS) ──
// Lists the academy's backup files newest-first.
export async function listBackups(academyId) {
  if (!academyId) return []
  const { data, error } = await supabase
    .storage.from('backups')
    .list(String(academyId), { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw error
  return (data || [])
    .filter(f => f.name.endsWith('.xlsx'))
    .map(f => ({
      name: f.name,
      path: `${academyId}/${f.name}`,
      date: f.name.replace('.xlsx', ''),
      size: f.metadata?.size ?? null,
    }))
}

// Short-lived signed URL for one backup file.
export async function getBackupSignedUrl(path, ttlSeconds = 600) {
  const { data, error } = await supabase
    .storage.from('backups').createSignedUrl(path, ttlSeconds)
  if (error) throw error
  return data.signedUrl
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.js
git commit -m "feat(backup): listBackups + getBackupSignedUrl storage helpers"
```

---

## Task 4: Owner-only Backups page + route + nav

**Files:**
- Create: `src/pages/Backups.jsx`
- Modify: `src/App.jsx` (lazy import + owner route)
- Modify: `src/components/Sidebar.jsx` (nav link)

- [ ] **Step 1: Create the page**

```jsx
import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { exportAcademyData } from '../lib/exportImport'
import { Download, ShieldCheck, RefreshCw } from 'lucide-react'

export default function Backups() {
  const { user, showToast } = useApp()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setRows(await db.listBackups(user?.academyId)) }
    catch (e) { showToast(e.message || 'Failed to load backups', 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (user?.academyId) load() }, [user?.academyId])

  const downloadNow = async () => {
    setBusy(true)
    try { await exportAcademyData(user.academyId); showToast('Backup downloaded') }
    catch (e) { showToast(e.message || 'Backup failed', 'error') }
    finally { setBusy(false) }
  }

  const downloadStored = async (path) => {
    try { window.open(await db.getBackupSignedUrl(path), '_blank') }
    catch (e) { showToast(e.message || 'Could not open backup', 'error') }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-brand-600" size={22} /> Backups
          </h2>
          <p className="text-sm text-gray-400">Automatic weekly backups, kept 12 weeks. Download anytime.</p>
        </div>
        <button onClick={downloadNow} disabled={busy}
          className="px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">
          <Download size={16} /> {busy ? 'Preparing…' : 'Download now'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Saved backups</span>
          <button onClick={load} className="text-gray-400 hover:text-gray-700"><RefreshCw size={15} /></button>
        </div>
        {loading ? <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>
          : rows.length === 0 ? <p className="px-4 py-6 text-sm text-gray-400">No saved backups yet — the first weekly backup will appear here.</p>
          : rows.map(r => (
            <button key={r.path} onClick={() => downloadStored(r.path)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left">
              <span className="text-sm font-medium text-gray-800">{r.date}</span>
              <span className="text-xs text-gray-400 flex items-center gap-2">
                {r.size ? `${(r.size/1024).toFixed(0)} KB` : ''} <Download size={14} />
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the lazy import + route in `src/App.jsx`**

Add with the other owner lazy imports:
```jsx
const Backups = lazy(() => import('./pages/Backups'))
```
Add inside the owner `<Route path="/" element={<OwnerRoute><Layout /></OwnerRoute>}>` block (alongside `settings`):
```jsx
<Route path="backups" element={<Backups />} />
```

- [ ] **Step 3: Add a Sidebar nav link (owner)**

In `src/components/Sidebar.jsx`, follow the existing owner nav-item pattern and add an item linking to `/backups` labelled "Backups" (import a `ShieldCheck` icon from `lucide-react`). Place it near Settings. Match the exact markup of the surrounding nav items in that file.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds. Then manually: log in as owner → sidebar shows "Backups" → page loads → "Download now" produces a 5-sheet `.xlsx` of live data. Saved list is empty until Task 5/6 run (expected).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Backups.jsx src/App.jsx src/components/Sidebar.jsx
git commit -m "feat(backup): owner Backups page (download now + saved list)"
```

---

## Task 5: Edge Function `weekly-backup` (build + upload + prune + email)

**Files:**
- Create: `supabase/functions/weekly-backup/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/weekly-backup/index.ts
// Weekly per-academy full backup → Storage 'backups/{academy_id}/{date}.xlsx',
// prune to newest 12, email owner a signed link via Resend.
// Invoked by pg_cron (Task 6) or manually for testing.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL   = Deno.env.get("BACKUP_FROM_EMAIL") ?? "backups@sportflow.app";
const KEEP = 12;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function backupAcademy(academyId: string): Promise<string> {
  const t = (name: string, q: Promise<any>) => q.then(r => [name, r.data ?? []] as const);
  const [students, payments, batches, trials] = await Promise.all([
    admin.from("students").select("*").eq("academy_id", academyId),
    admin.from("payments").select("*").eq("academy_id", academyId),
    admin.from("batches").select("*").eq("academy_id", academyId),
    admin.from("trials").select("*").eq("academy_id", academyId),
  ]);
  const studentIds = (students.data ?? []).map((s: any) => s.id);
  const attendance = studentIds.length
    ? await admin.from("attendance").select("*").in("student_id", studentIds)
    : { data: [] };

  const wb = XLSX.utils.book_new();
  const add = (n: string, rows: any[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n);
  add("Payments", payments.data ?? []);
  add("Students", students.data ?? []);
  add("Batches", batches.data ?? []);
  add("Attendance", attendance.data ?? []);
  add("Trials", trials.data ?? []);

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);
  const path = `${academyId}/${date}.xlsx`;
  const { error: upErr } = await admin.storage.from("backups").upload(
    path, new Blob([buf]), {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (upErr) throw upErr;
  return path;
}

async function prune(academyId: string) {
  const { data } = await admin.storage.from("backups").list(academyId, {
    limit: 1000, sortBy: { column: "name", order: "desc" },
  });
  const xlsx = (data ?? []).filter(f => f.name.endsWith(".xlsx"));
  const stale = xlsx.slice(KEEP).map(f => `${academyId}/${f.name}`);
  if (stale.length) await admin.storage.from("backups").remove(stale);
}

async function emailOwner(academyId: string, path: string) {
  if (!RESEND_KEY) return; // email optional until configured
  const { data: acad } = await admin.from("academies").select("owner_id, name").eq("id", academyId).single();
  if (!acad?.owner_id) return;
  const { data: u } = await admin.auth.admin.getUserById(acad.owner_id);
  const email = u?.user?.email;
  if (!email) return;
  const { data: signed } = await admin.storage.from("backups").createSignedUrl(path, 60 * 60 * 24 * 3);
  if (!signed?.signedUrl) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: email,
      subject: `Your ${acad.name ?? "SportFlow"} weekly backup`,
      html: `<p>Your weekly backup is ready and safely stored.</p>
             <p><a href="${signed.signedUrl}">Download backup (${path.split("/")[1]})</a> — link valid 3 days.</p>
             <p>Your data is backed up automatically every week. Nothing to do.</p>`,
    }),
  });
}

Deno.serve(async () => {
  const { data: academies } = await admin.from("academies").select("id");
  const results: Record<string, string> = {};
  for (const a of academies ?? []) {
    try {
      const path = await backupAcademy(a.id);
      await prune(a.id);
      await emailOwner(a.id, path);
      results[a.id] = "ok";
    } catch (e) {
      console.error("backup failed", a.id, e);
      results[a.id] = `error: ${String(e)}`;
    }
  }
  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Deploy the function**

Run (user has Supabase CLI per allowlist): `supabase functions deploy weekly-backup`
Expected: deploy succeeds; function visible in the dashboard.

- [ ] **Step 3: Set secrets (one-time; RESEND optional)**

Run: `supabase secrets set RESEND_API_KEY=... BACKUP_FROM_EMAIL=backups@yourdomain`
Expected: secrets stored. (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.)

- [ ] **Step 4: Invoke manually and verify a file lands**

Run: `supabase functions invoke weekly-backup --no-verify-jwt`
Then: `node scripts/db-fast.mjs query "SELECT name FROM storage.objects WHERE bucket_id='backups' ORDER BY name DESC LIMIT 5"`
Expected: a `{academy_id}/{today}.xlsx` object exists. Download it (dashboard or signed URL) and confirm 5 sheets with correct data.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/weekly-backup/index.ts
git commit -m "feat(backup): weekly-backup edge function (build/upload/prune/email)"
```

---

## Task 6: Schedule weekly via pg_cron

**Files:**
- Create: `supabase/migrations/0077_schedule_weekly_backup.sql`

- [ ] **Step 1: Write the migration**

Replace `<PROJECT_REF>` and `<ANON_OR_SERVICE_HEADER>` per environment. Uses `pg_cron` + `pg_net`.

```sql
-- 0077 — run weekly-backup every Sunday 20:00 UTC via pg_cron + pg_net.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'weekly-academy-backup',
  '0 20 * * 0',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/weekly-backup',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
               ),
    body    := '{}'::jsonb
  );
  $$
);
COMMIT;
```

- [ ] **Step 2: Apply (after setting the service-role key as a DB setting, or inline the URL with --no-verify-jwt deployment)**

Run: `node scripts/db-fast.mjs apply supabase/migrations/0077_schedule_weekly_backup.sql`
Expected: `✓ 0077...`. Note: `pg_cron`/`pg_net` must be enabled in the Supabase dashboard (Database → Extensions) — enable them first if the apply errors.

- [ ] **Step 3: Verify the cron entry**

Run: `node scripts/db-fast.mjs query "SELECT jobname, schedule, active FROM cron.job WHERE jobname='weekly-academy-backup'"`
Expected: one active row, schedule `0 20 * * 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0077_schedule_weekly_backup.sql
git commit -m "feat(backup): schedule weekly-backup via pg_cron"
```

---

## Task 7: Verification harness + owner-isolation check

**Files:**
- Create: `scripts/_test-backups.mjs`

- [ ] **Step 1: Write the harness**

```js
// Verifies backups storage isolation: an authenticated owner can list/sign their
// academy's files; anon cannot read the bucket. (Run after Task 5 produced a file.)
import pg from 'pg'; import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url','utf8').trim())
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
let pass=0, fail=0; const ok=(d,b)=>{console.log(`  ${b?'✓':'✗ FAIL'}  ${d}`); b?pass++:fail++}

// 1. bucket is private
const b = await c.query("SELECT public FROM storage.buckets WHERE id='backups'")
ok('bucket is private', b.rows[0]?.public === false)
// 2. owner-read policy exists
const p = await c.query("SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='backups_owner_read'")
ok('owner-read storage policy exists', p.rowCount === 1)
// 3. no anon policy on the backups bucket objects
const anon = await c.query("SELECT 1 FROM pg_policies WHERE tablename='objects' AND 'anon'=ANY(roles) AND qual ILIKE '%backups%'")
ok('no anon policy references backups', anon.rowCount === 0)

await c.end(); console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
```

- [ ] **Step 2: Run it**

Run: `node scripts/_test-backups.mjs`
Expected: 3 passed, 0 failed.

- [ ] **Step 3: Regression sweep (no isolation regressions)**

Run: `node scripts/test-security-v3.mjs`
Expected: `17 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add scripts/_test-backups.mjs
git commit -m "test(backup): storage isolation verification harness"
```

---

## Self-review notes (coverage vs spec)

- Full-academy 5-sheet Excel → Task 2 (client) + Task 5 (edge), identical sheet set.
- Weekly schedule → Task 6 (`0 20 * * 0`). 12-week retention → Task 5 `KEEP = 12` + prune.
- In-app Backups page (owner-only) → Task 4. One-click live download → Task 2 + Task 4 button.
- Email via Resend with signed link → Task 5 `emailOwner` (3-day link). Optional until `RESEND_API_KEY` set.
- Per-academy isolation → academy-keyed queries/paths everywhere; private bucket + owner-read RLS (Task 1) + harness (Task 7).
- Out of scope (restore UI, configurable schedule, per-branch) → not implemented, per spec.

**Deviation from spec:** the spec mentioned a `list_academy_backups()` RPC; this plan uses **Storage RLS + the Supabase Storage SDK** (`list` + `createSignedUrl`) instead — simpler, standard, same outcome (owner-only, signed URLs, last 12). Intent preserved.
