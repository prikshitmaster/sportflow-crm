# SportFlow CRM — orientation

Sports academy management CRM. React 18 + Vite web app; the "mobile app" is this
same codebase wrapped in Capacitor — not a separate build. Backend is Supabase
(Postgres + Auth + RPCs + Storage + Realtime for notifications only).

This file is verified against the actual code/migrations as of **2026-07-31**.
`docs/*.md`, `AUDIT.md`, and `TESTING.md` in this repo were last touched
May–June 2026 and have drifted — treat them as background reading, not truth;
verify anything specific against current code/migrations before relying on it.

## Before touching anything: the two-clone gotcha

**Two independent clones of this exact repo exist on this machine**, both real,
both able to diverge in commits:
- `C:\Users\91814\Desktop\clubcrm\sportflow-crm` — has `.env`, is what the dev
  server (`localhost:5173`) and IDE actually run from. **Default to editing here.**
- `C:\Users\91814\sportflow-crm` — also a legitimate clone of the same GitHub
  remote, no `.env`.

Before assuming either is current: `git log --oneline -3` in **both**, and
`git fetch && git log HEAD..origin/main` to check for a silent gap. If you edit
in the other clone for some reason, commit, push, then `git pull --ff-only`
into the Desktop clone immediately — a fix left only in the non-dev clone is
invisible to the user no matter how correct it is.

## How the app is put together

- **One-way data flow, enforced by convention, not tooling**: pages call
  `useApp()` (from `src/context/AppContext.jsx`) → context actions call
  `src/lib/db.js` → `db.js` calls Supabase. Pages should never import
  `supabase` directly.
- **`AppContext.jsx`** (~2500 lines) is the single global store: auth for all
  4 roles, all shared CRM data as `useState`, branch/sport-scoped `useMemo`
  derivations, and every mutating "action" (`addPayment`, `markAttendance`,
  `updateBatch`, etc.). Each action awaits the DB write then splices the
  result into local state directly — same-session UI updates instantly, no
  refetch needed.
- **`db.js`** (~80 functions, ~3200 lines) is the only file that talks to
  Supabase: PostgREST reads, `secure_*` RPC calls for writes, snake_case→
  camelCase mapping at the boundary. **Mixing up snake_case/camelCase here is
  a real recurring bug class** — server rows are snake_case, app state is
  camelCase; reading the wrong one silently returns `undefined` instead of
  erroring.

### Roles, routing, and portals (`src/App.jsx`)

Four roles, each with fully separate routes/layout, gated by dedicated guard
components in `App.jsx:178-285`:
- **Owner** — `/` (Layout), full academy access, picks active sport/branch.
- **Staff** — `/staff/*` (StaffLayout). Coaches only through `StaffRoute`;
  non-coach office staff render the *owner* pages instead, gated per-route by
  `PermRequired` (`hasPermission(perm)` from context — UI-side only, real
  enforcement is the RPC layer).
- **Parent** — `/parent/*`, phone-OTP auth via `parents`/`parent_students`.
- **Student** — `/student/*`, custom token auth.
- **Public, no auth**: `/pay/:shortCode` (Razorpay), `/invite/:token`,
  `/activate`, printable report routes.
- **`/ops/live`** — unlinked, PIN-gated via `VITE_OPS_PIN` env var, fails
  closed if the env var is unset.

Full page-by-page map lives in this session's investigation, not repeated
here — glob `src/pages/`, `src/pages/staff/`, `src/pages/parent/`,
`src/pages/student/` for the current list; names are self-descriptive.

### `src/lib/` quick index

`db.js` (data access) · `auth.js` (staff/student custom token sessions;
owner/parent use real Supabase Auth) · `permissions.js` (RBAC keys, UI-side)
· `audit.js` (audit trail) · `notifications.js` (in-app + web push, the
**only** table using Supabase Realtime today) · `fcm.js` (Android-native push)
· `dates.js` (IST-local date strings — **always use this over
`toISOString()`**, UTC rollover bugs are a known trap) · `studentRules.js`
(single source of truth for "is this student overdue") ·
`announcementAudience.js` (single source of truth for notice targeting) ·
`schemas.js` (Zod, additive/incremental, not everywhere yet) ·
`sportCatalog.js` (mirrors a DB migration — keep in sync if sports change).

## Database / RLS model

Migrations live in **three places, don't confuse them**:
- `supabase/migrations/0001`–`0127` — the linear history, highest number wins.
  Some entries are dry-run/rollback pairs (`0015a/0015b`, `0019a`–`0019e`) —
  the last-lettered file is authoritative.
- `supabase/security-v3/01`–`23` — a separate, deliberately-isolated RLS
  hardening pass with its **own numbering restarting from 1** (not a
  continuation of 0087+). Work interleaves by timestamp across both folders,
  not by folder — check both when tracing a table's current policy.
- Legacy `schema.sql` / `schema_rls.sql` at the repo root are **historical,
  superseded, and dangerous** — they disable RLS / use `USING(true)`. Never
  re-run them.

**Write pattern**: almost all writes go through `secure_*` (or `create_*`)
RPCs — `SECURITY DEFINER`, take `p_token` explicitly, internally do
`current_actor(p_token)` → `_require_perm` → `_require_branch_scope`
(template in `security-v3/01_actor_branch_helper.sql`). New CRUD should follow
this template, not raw table writes.

**Read pattern**: RLS policies keyed on `current_staff_academy()` /
`current_student_academy()`, resolved from `x-staff-token`/`x-student-token`
request headers set in `src/lib/supabase.js` (see `0004_session_header_rls.sql`).
Branch-scoped tables additionally gate on `current_staff_branch()` (NULL =
office staff, sees all branches).

**Known-intentional exceptions — do not "fix" without reading the migration
that put them there first**:
- `gate_qr` has no tenant-scoped SELECT (wide open by design — pre-auth QR
  scan; real enforcement is inside `secure_mark_attendance_qr`).
- `student_sessions` and some session tables are `FOR ALL USING(true)` at the
  RLS layer on purpose — locked down at the RPC layer instead (sec-v3 Phase 3.1).
- Untargeted `FOR ALL` policies defaulting to PUBLIC caused a real shipped
  regression once (`notifications`/`push_subscriptions` in sec-v3/12, fixed in
  sec-v3/13) — grep for this pattern before locking any other table.

## What's fresh / highest-risk right now (last ~48h as of 2026-07-31)

These areas are the least battle-tested — treat extra carefully:
- **RLS/security-v3 policies** — still seeing fixes-of-fixes on the same
  policies (staff permissions, academies write policy, assessments,
  session_feedback, staff_checkins). The layer is still settling.
- **Trial-fee revenue model** (migrations 0124-0126) — has a pre-built,
  explicitly-ordered rollback script in `supabase/rollbacks/`, a strong signal
  it's considered unstable enough to need a fast undo path.
- **Staff Notices / announcements** — read-receipts and history section
  landed today, still in flux.
- **Age Groups** (migration 0123) — brand new table + RPCs, hours old.
- **FCM push** — new subsystem, several same-day bug fixes (stale-token
  cleanup, JWT signing, CORS).
- **Cross-tab/device data refresh** — same-session CRUD updates local state
  instantly; cross-session sync (web tab vs. mobile app) is polling-on-focus
  (60s throttle, silent refresh, no realtime) as of the 2026-07-31 fix in
  `AppContext.jsx` — not true push sync. Two screens left open side by side
  the whole time won't see each other's changes until one refocuses.

## Testing reality — there is no safety net

`package.json` has `test`/`test:students`/`test:payments` scripts and
`playwright.config.ts` points at `./tests`, but **the `tests/` directory does
not exist** — nothing runs, nothing is tracked in git for it. `TESTING.md` is
a stale (2026-05-24) manual human checklist, not automation.

The only real automated checks are RLS/permission probe scripts in
`scripts/` (`test-security-v3.mjs`, `_test-*-rls.mjs`, `_test-perm-matrix.mjs`)
— these verify access control, not UI or business-logic correctness. There is
**zero automated coverage** for payments, trials, batches, attendance UI,
staff-permission gating, parent portal, student portal, age groups, or
trial-fee linking. A regression in any of these is caught only by manual
testing — budget time for it after any non-trivial change, especially in the
"what's fresh" list above.

## Misc

- `typescript: ^6.0.3` and `zod: ^4.4.3` in `package.json` are real (verified,
  not a typo) but unusual majors for what's otherwise plain JSX with
  incremental Zod adoption — if either starts causing friction, that's why.
- `data/mockData.js` is static demo data for onboarding, not live data — don't
  confuse it with real fixtures.
- Two dead/deprecated client-side login paths remain in `db.js` (~line 998,
  ~1377) now that `secure_login_staff`/`secure_login_student` create the
  session server-side — leave them alone unless specifically touching login.
