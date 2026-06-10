# Interview Guide — explain every part of SportFlow CRM

> Read this top to bottom and you can answer "walk me through your project"
> plus the follow-up questions. Each section: the concept → how THIS project
> uses it → a likely interview question with the answer.

---

## 1. The 30-second pitch

> "SportFlow is a multi-tenant CRM for sports academies. It's a React 18 + Vite
> single-page app with Supabase (hosted Postgres) as the backend — there is no
> custom API server. Security is enforced inside the database with Row Level
> Security and SECURITY DEFINER functions. One codebase ships as a PWA on
> Vercel, an Android app via Capacitor, and a Windows desktop app via Electron.
> It has four separate role-based portals: owner, staff, student, and parent,
> with two different authentication systems. It manages ~320 students, fee
> collection with overdue tracking, QR-code attendance, staff clock-in, skill
> assessments, and reporting."

---

## 2. React concepts used (and where to see them)

### 2.1 Components & JSX
Every screen is a function component in `src/pages/`. JSX is HTML-like syntax
that compiles to `React.createElement` calls. Example: `StaffScanIn.jsx` returns
different JSX blocks depending on a `phase` state ('ready' | 'scanning' | 'success'...).

### 2.2 useState — local screen state
```jsx
const [phase, setPhase] = useState('ready')
```
State that only one screen cares about (modal open?, current tab, form fields).
Calling the setter re-renders the component with the new value.

### 2.3 useEffect — side effects
Runs code *after* render: fetching data, subscribing, timers, camera start/stop.
The dependency array controls when it re-runs. The **cleanup function** (the
returned function) runs on unmount — see `StaffScanIn.jsx`:
```jsx
useEffect(() => () => stopCamera(), [])   // stop camera when leaving the page
```

### 2.4 useContext — global state (THE key pattern here)
`src/context/AppContext.jsx` creates one context that holds the logged-in user,
all data arrays (students, payments, attendance, staff, batches…), and every
action (addStudent, collectPayment…). Any component calls:
```jsx
const { students, user, collectPayment } = useApp()
```
**Why Context and not Redux?** One provider, moderate update frequency, no
need for middleware/time-travel — Context + useMemo is simpler and sufficient.
**Trade-off to mention:** a context update re-renders all consumers; we keep
derived data in `useMemo` to limit recomputation.

### 2.5 useMemo — computed values & the filtering layer
Branch and sport filtering is done client-side:
```jsx
const students = useMemo(
  () => rawStudents.filter(s => matchesBranch(s) && matchesSport(s)),
  [rawStudents, effectiveBranch, selectedSport]
)
```
The DB returns all rows for the academy; `useMemo` chains derive what the
current user/branch/sport should see, recomputing only when inputs change.

### 2.6 useRef — values that don't trigger re-render
Camera stream handles, `requestAnimationFrame` ids, "already processed" flags:
```jsx
const streamRef = useRef(null)   // survives re-renders, changing it re-renders nothing
```

### 2.7 React Router 6 — routing & guards
`App.jsx` defines all routes. Role guards are wrapper components:
```jsx
function OwnerRoute({ children }) {
  const { user, role } = useApp()
  if (!user || role !== 'owner') return <Navigate to="/login" />
  return children
}
```
Layout routes use `<Outlet/>`: the sidebar/header render once, the page swaps inside.

### 2.8 Code splitting — React.lazy + dynamic import
Pages load on demand (`React.lazy(() => import('./pages/Reports'))`), and heavy
libraries load only inside the function that needs them:
```jsx
const ExcelJS = (await import('exceljs')).default   // only when exporting
```
Result: first paint ships ~150 KB gzip instead of several MB.

### 2.9 Controlled components
Form inputs hold their value in state (`value={name} onChange={e => setName(e.target.value)}`)
so React state is the single source of truth — validation and submission read state, not the DOM.

---

## 3. The database (Supabase / PostgreSQL)

### 3.1 Multi-tenancy
One database serves many academies. Every row carries `academy_id`; every query
filters by it. This is "shared schema multi-tenancy" — cheapest to operate;
isolation is enforced by RLS + RPC checks.

### 3.2 Main tables (30+ total)
| Table | Purpose | PK type |
|---|---|---|
| `profiles` | owner accounts (mirrors Supabase Auth) | **UUID** |
| `students` | players: fees, paid_till, batch, branch, status | BIGINT |
| `staff` | coaches/office/managers + cached attendance % | BIGINT |
| `payments` | every fee collection (amount, month, mode, coverage) | BIGINT |
| `attendance` | one row per student per day (unique date+student+batch) | BIGINT |
| `staff_checkins` | staff clock-in/out per day (unique staff+date) | BIGINT |
| `batches` | training groups (days, timings, coach, capacity) | BIGINT |
| `trials` | trial bookings → conversion funnel | BIGINT |
| `staff_sessions` / `student_sessions` | custom auth tokens | BIGINT |
| `audit_logs` | who did what, with before/after diffs | BIGINT |

**Interview trap this project actually hit:** owner ids are UUID but staff and
student ids are BIGINT. An RPC declared `p_profile_id UUID` while staff sent a
BIGINT → silent failure. Lesson: keep id types consistent, or name parameters
by type.

### 3.3 Indexes (what & why)
An index is a sorted lookup structure; without one, filtering = full table scan.
We index what queries filter on: `payments(academy_id, student_id)`,
`attendance(student_id, date)`, `staff_checkins(academy_id, date)`,
session `token` (UNIQUE). We also *dropped duplicate* indexes — each extra
index slows every write for zero read gain.

### 3.4 Row Level Security (RLS)
Postgres policies that filter every query per-requester, *inside* the database.
Even if someone calls the REST API directly with the public anon key, policies
decide what they can touch. Here: SELECT stays open for the custom-auth roles
(staff/students authenticate via tokens, not JWT — see 4), but **all writes are
locked** and must go through RPCs.

### 3.5 The RPC (SECURITY DEFINER) pattern — the project's "API layer"
Every write is a Postgres function, e.g. `secure_update_student(...)`:
1. `current_actor(p_token)` → who is calling (owner JWT / staff token / student token)
2. `_require_perm(actor, 'students.manage')` → are they allowed
3. `_require_branch_scope(actor, branch_id)` → in their branch only
4. Perform the write. `SECURITY DEFINER` = function runs with elevated rights
   even though the caller can't touch the table directly.

This is the same shape as a REST controller (authn → authz → action) — it just
lives in SQL instead of Node. Migrations 0033–0054 introduced it table by table:
first a `secure_*` function, then a lock-anon migration removing direct access.

### 3.6 Migrations
`supabase/migrations/0001 → 0097` is the database's version history. Rule:
**never edit an applied migration** — append a new one. 0096/0097 are the
audit's index tuning + IST fix.

---

## 4. Authentication — two systems, four roles

### 4.1 Owner & Parent — Supabase Auth (JWT)
Standard email+password (owner) / phone OTP (parent). Supabase issues a JWT;
the client library attaches it to every request; Postgres sees role
`authenticated` and `auth.uid()` = the user's UUID.

### 4.2 Staff & Student — custom token sessions
Why custom? Coaches and students shouldn't cost Auth seats or manage email
accounts; the academy creates them.
1. Login form → password hashed with **SHA-256** in the browser
2. RPC compares hash, generates a random session token, stores a row in
   `staff_sessions` / `student_sessions` with `expires_at`
3. Token saved to `localStorage` (`sf_staff` / `sf_student`)
4. Every later RPC call passes `p_token`; `current_actor()` resolves it
   server-side. Logout/expiry = the token row dies; the client can't fake one.

### 4.3 Session restore order (shared-device safety)
On app open, AppContext checks **custom tokens first**, JWT last:
student token → staff token → Supabase JWT → show login.
Why: on a shared academy tablet an owner JWT might still linger; checking the
student token first prevents the student seeing owner data.

### 4.4 Login throttling
`src/lib/loginThrottle.js` delays repeated failed logins (brute-force protection).

---

## 5. Feature deep-dives you can narrate

### 5.1 QR attendance (student gate scan)
* `AdminQR.jsx` displays a **rotating QR** on the gate screen containing
  `academyId : branchId : date : hour`. It changes hourly → screenshots from
  yesterday don't work; branch lock stops cross-branch scans.
* Student opens StudentScan → camera → `BarcodeDetector` (native, fast) with
  **jsQR fallback** (works everywhere) → validate prefix/academy/branch/date/hour
  → `secure_mark_attendance_qr` RPC marks them present (idempotent: a unique
  index on date+student prevents duplicates).
* Staff clock-in (`StaffScanIn` → `secure_clock_in`) is the same idea; the RPC
  takes **no id parameter** — identity comes from the session token, so nobody
  can clock in someone else.

### 5.2 Fees & overdue logic
`students.paid_till` = the date fees are covered to. `lib/studentRules.js`
derives status (`isOutstanding`, `daysOverdue`, ageing buckets 0-7/8-30/31+) —
pure functions, easy to test. Collecting a payment writes a `payments` row and
advances `paid_till` to month-end of the covered period
(`new Date(y, m + months, 0)` = day 0 of next month = last day of target month).

### 5.3 Branch & sport isolation
Reads come academy-wide; **client-side** useMemo filters by branch+sport.
Writes are **server-enforced** (`_require_branch_scope`). For staff, the
effective branch is always `user.branchId` (their assignment), never the
owner's branch picker. Honest trade-off: a determined staff member could read
other branches' data via the API (writes are blocked); acceptable risk inside
one academy and fixable later with branch-scoped RLS reads.

### 5.4 PWA / offline
`vite-plugin-pwa` (injectManifest) + `src/sw.js`: precaches the built assets,
`NetworkFirst` with 3 s timeout for navigation (fresh if online, instant shell
if not), `skipWaiting + clientsClaim` so updates apply immediately. The hashed
assets are also cached **immutable** at the CDN (vercel.json).

### 5.5 Same code → Android & Windows
* **Capacitor**: native WebView wrapper; production config points at the Vercel
  URL → every web deploy updates the installed app with no APK rebuild.
* **Electron**: `electron/main.cjs` serves `dist/` over a custom `app://`
  protocol with an explicit MIME map — because Windows registry often maps `.js`
  to `text/plain`, which Chromium rejects for ES modules (white-screen bug).

---

## 6. The timezone bug — your best interview story

(Full detail: `docs/08_JUNE_2026_AUDIT.md`.) Short version:

> "Attendance dates were derived with `toISOString()`, which returns the UTC
> day — India is UTC+5:30, so before 05:30 IST that's *yesterday*. Worse,
> `new Date(y, m, 1).toISOString()` converts local midnight to UTC, so every
> month-boundary string was off by one day all day — it shifted our overdue-fee
> calculations. I fixed it in three layers: a local-date helper module on the
> client (~70 call sites migrated with a codemod), an `ist_today()` function in
> Postgres, and a migration that rewrote the 10 live RPCs that stamped
> `CURRENT_DATE` — patched from their live definitions via `pg_get_functiondef`,
> so the fix couldn't miss a function whose migration source was stale.
> Then I verified with SQL that zero `CURRENT_DATE` references remained."

Concepts it demonstrates: timezones, UTC vs local dates, codemods, live-schema
introspection, and coordinated client+DB deployment.

---

## 7. Rapid-fire Q&A

**Why no backend server?** Supabase generates a REST API over Postgres; RLS +
SECURITY DEFINER functions give us authn/authz/business rules in the DB. Less
infrastructure, fewer moving parts. Cost: complex logic lives in SQL.

**SQL injection?** All access is parameterized via supabase-js / RPC parameters;
no string-concatenated SQL in the client.

**Why is the password hashed client-side, and is SHA-256 enough?** It avoids
ever transporting the raw password. For higher security I would move to bcrypt
or Argon2 server-side — SHA-256 is fast which makes brute-forcing easier; we
mitigate with login throttling. (Owner/parent accounts already use Supabase
Auth which uses bcrypt internally.)

**How do you prevent duplicate attendance?** A unique index on
`(date, student_id, batch_id)` (+ a NULL-batch variant). The DB is the last
line of defense — UI checks alone can race.

**Why Vite over CRA/Webpack?** Native ESM dev server = instant start/HMR;
Rollup production builds; first-class code-splitting.

**How do you keep the bundle small?** Route-level `React.lazy`, dynamic
`import()` for heavy libs, manualChunks only for stable vendors (react,
supabase), lucide icons tree-shake, immutable CDN caching for repeat visits.

**How would you scale this?** Move branch filtering into RLS reads, add
pagination on the wire (currently client-side), background sync for offline
writes, and a queue for WhatsApp/notification sending.

**What would you improve first?** Real test coverage. Playwright is configured
but the test suite is missing — I'd add E2E happy paths (login, add student,
collect payment, mark attendance) and unit tests for `studentRules.js` and
`dates.js`, which are pure functions.
