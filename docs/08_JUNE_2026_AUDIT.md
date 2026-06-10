# June 2026 Full Audit & Fixes — what was done and WHY

> Date: 10 June 2026. This file records the complete software audit and every fix
> applied, written so you can explain each one (e.g. in an interview).

---

## Part A — What was checked and found HEALTHY

| Check | How it was checked | Result |
|---|---|---|
| Production build | `npm run build` | ✅ Clean, no errors |
| Row Level Security | `pg_class.relrowsecurity` for all public tables | ✅ RLS enabled on **every** table |
| Orphaned data | SQL anti-joins (attendance→students, payments→students, students→batches) | ✅ Zero orphans |
| Secrets | `git ls-files` for `.env` | ✅ Not committed (only `.env.example`) |
| Session hygiene | expired-token counts in `staff_sessions`/`student_sessions` | ✅ No buildup |
| Code hygiene | grep for `console.log` | ✅ Zero in `src/` |
| Bundle strategy | build output + `vite.config.js` | ✅ Heavy libs (exceljs, recharts, jsQR) already lazy-loaded in route chunks |

---

## Part B — Fixes applied

### B1. Dependency security (npm)

* `npm audit fix` patched (non-breaking, lockfile-only):
  * **react-router** — open-redirect vulnerability (a crafted `//evil.com` path could redirect users off-site)
  * **ws** — uninitialized memory disclosure
  * **brace-expansion** — denial-of-service
* **Removed `xlsx`** — it had a HIGH severity vulnerability with *no fix available*…
  and a grep proved it was **never imported anywhere** (the app uses `xlsx-js-style`).
  Deleting an unused dependency = vulnerability gone for free.
* **Removed `html5-qrcode`** — also unused (scanning uses `jsQR` + native `BarcodeDetector`).
* Still open (deliberately): Electron 33→42, Vite 5→8, electron-builder upgrades.
  These are **dev/build-time only** (never shipped to users) and are breaking
  major-version jumps — schedule separately.

### B2. Dead code

* Deleted `logStaffAttendance()` from `src/lib/db.js`. It called the old broken
  RPC `secure_log_staff_attendance` (UUID parameter vs BIGINT staff id — could
  never work) and nothing called it. Clock-in had already been replaced by
  `secure_clock_in` (migration 0085) which resolves the staff member from the
  session token, so no id-type bug is possible.

### B3. Hosting headers (`vercel.json`)

```
/assets/*  → Cache-Control: public, max-age=31536000, immutable
/sw.js     → Cache-Control: no-cache
all routes → X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
```

**Why:** Vite gives every built file a content-hash name (`index-BFinSAOO.js`),
so a file's content can never change under the same name → safe to cache for a
year (**immutable**) → repeat visits skip re-downloading ~1.5 MB. The service
worker itself must be `no-cache` so updates are noticed immediately. The
security headers stop MIME-sniffing, clickjacking (iframes), and leaky referrers;
`Permissions-Policy` keeps **camera allowed** (QR scanning needs it) but blocks
microphone/geolocation.

### B4. Database indexes — migration `0096_index_tuning.sql`

* **Added** `idx_staff_checkins_academy_date` on `staff_checkins (academy_id, date)` —
  the owner's Staff page queries exactly this pair (day view + month view);
  without it Postgres scans the whole table.
* **Dropped 3 duplicate indexes** on the session tables — `token` was indexed
  2–3 times (a UNIQUE constraint already indexes it). Duplicates give zero read
  benefit and slow every insert/delete.

---

## Part C — THE BIG BUG: UTC vs IST day boundary

### The problem, in one sentence
JavaScript's `toISOString()` and Postgres' `CURRENT_DATE` both work in **UTC**,
but India is **UTC+5:30** — so "today" was wrong in two ways:

**Class 1 — wrong before 05:30 IST** (early-morning sessions!):
```js
new Date().toISOString().slice(0, 10)
// At 5:00 AM IST on June 10 → "2026-06-09"  ❌ yesterday!
```
A coach clocking in at 5 AM was recorded present for the *previous* day, and the
owner's day view (which reads by IST date) showed them absent.

**Class 2 — wrong ALL DAY, every day** (the sneaky one):
```js
new Date(2026, 5, 1)              // June 1, 00:00 *local IST* time
  .toISOString()                  // = "2026-05-31T18:30:00Z"  (UTC is 5:30 behind)
  .split('T')[0]                  // = "2026-05-31"  ❌ previous month!
```
Local-midnight dates always convert to *the previous day* in UTC. This silently
shifted: `paid_till` month-end calculations, every "first of month" revenue
filter (Dashboard, Payments, Reports, SportSelect), and
`studentRules.todayIso()` — the function behind **all overdue-fees logic**.

### The fix (3 layers, ~70 call sites)

1. **New helper `src/lib/dates.js`** — builds date strings from local calendar
   parts (`getFullYear/getMonth/getDate`), which can never cross a UTC boundary:
   * `toLocalDateStr(d)` → `"YYYY-MM-DD"`
   * `todayStr()` → today
   * `toLocalMonthStr(d)` → `"YYYY-MM"`
2. **Client codemod** — every `toISOString().slice(0,10)`, `.split('T')[0]`, and
   `.slice(0,7)` in `src/` was replaced with the helpers (29 files). A grep now
   returns zero matches.
3. **Server — migration `0097_ist_day_boundary.sql`**:
   * created `ist_today()` = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
   * rewrote the **10 live RPCs** that stamped `CURRENT_DATE`
     (`secure_clock_in`, `secure_get_today_checkin`, `secure_mark_attendance`,
     `secure_mark_attendance_qr`, `create_student_with_payment`,
     `secure_insert_payment`, `secure_insert_staff`, `secure_insert_announcement` ×2,
     `secure_complete_invite_signup`, `secure_record_gateway_payment`).
   * Clever part: the migration takes each function's **live** definition with
     `pg_get_functiondef()` and regex-replaces `CURRENT_DATE` → `ist_today()`,
     so it can never clash with an out-of-date migration source.

### Verified
* `SELECT ist_today()` returns the IST calendar date. ✅
* All 11 function definitions: `CURRENT_DATE` count = 0, `ist_today` present. ✅
* Full production build passes. ✅

### Known leftover (accepted)
`paid_till` values written *before* the fix can be 1 day short of month-end
(e.g. June 29 instead of June 30). Not backfilled on purpose — it self-corrects
on each new payment, and guessing which 29ths were bugs vs real is risky.

### Interview takeaway
"A date is not a timestamp." Store and compare **calendar dates** in the
timezone the business operates in. `toISOString()` is for machine timestamps,
never for "what day is it for my user".

---

## Part D — Files changed in this audit

| File | Change |
|---|---|
| `package.json` / `package-lock.json` | security patches; removed `xlsx`, `html5-qrcode` |
| `vercel.json` | caching + security headers |
| `src/lib/dates.js` | **new** — local-date helpers |
| `src/lib/db.js` | removed dead `logStaffAttendance`; date fixes |
| `src/context/AppContext.jsx` | date fixes (paid_till calc etc.) |
| 24 more files in `src/` | mechanical date-helper migration |
| `supabase/migrations/0096_index_tuning.sql` | **new** — applied to production |
| `supabase/migrations/0097_ist_day_boundary.sql` | **new** — applied to production |
| `README.md`, `docs/08`, `docs/09` | this documentation |
