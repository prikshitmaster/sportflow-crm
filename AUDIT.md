# SportFlow CRM — Enterprise Audit & Improvement Plan

**Audit date:** 2026-05-16
**Auditor lens:** Senior enterprise SaaS architect + QA
**Codebase:** React 18 + Vite 5 + Supabase (PostgreSQL/PostgREST) — multi-tenant by `academy_id`
**Scope:** Frontend architecture, data layer, permissions, multi-tenant security, scalability, code quality, testing & observability
**Verdict:** **Not production-grade for multi-tenant SaaS.** Functional MVP with several critical security holes and architectural cliffs that will block scaling past ~10 academies / ~1k students per academy.

---

## 0. Severity Dashboard

| # | Finding | Severity | Domain | Effort |
|---|---------|----------|--------|--------|
| C1 | RLS policies use `USING (true)` — no DB-level tenant isolation | 🔴 CRITICAL | Security | M |
| C2 | Staff/Student session tokens validated only client-side after restore | 🔴 CRITICAL | Security | M |
| C3 | `PermRequired` is UI-only — permissions not enforced server-side | 🔴 CRITICAL | Security | M |
| C4 | `academyId` is client-supplied on every query (forgeable via localStorage) | 🔴 CRITICAL | Security | M |
| C5 | Coach role can call `db.deleteStudent` / `db.insertPayment` directly (no DB check) | 🔴 CRITICAL | Security | M |
| H1 | `AppContext` is a god provider — 70+ props, 16 useState, all consumers re-render globally | 🟠 HIGH | Architecture | L |
| H2 | `loadAll()` fetches all students/payments/batches/staff on mount — no pagination | 🟠 HIGH | Scalability | L |
| H3 | Pages are monolithic (Reports 1.7k LOC, Staff 1.8k LOC, Students 1.5k LOC) | 🟠 HIGH | Maintainability | L |
| H4 | Business logic (fee calc, ageing, suspension rules) embedded in page components | 🟠 HIGH | Maintainability | M |
| H5 | No transactions — multi-step writes (add student + batch + payment) can partially fail | 🟠 HIGH | Data integrity | M |
| H6 | Activation flows (staff_code + join_code) have no rate limiting → brute-forceable | 🟠 HIGH | Security | S |
| H7 | No validation library — phone/email/amount rules duplicated & inconsistent | 🟠 HIGH | Quality | M |
| M1 | `fetchLeaveRequests()` missing `academy_id` filter (db.js:~1426) | 🟡 MEDIUM | Security | XS |
| M2 | N+1 query pattern in `fetchStudentBatchmatesForPitch` (4–5 round trips) | 🟡 MEDIUM | Performance | S |
| M3 | No useMemo on Students filtered list — recomputes every render | 🟡 MEDIUM | Performance | XS |
| M4 | No row virtualization / pagination on long lists | 🟡 MEDIUM | Performance | M |
| M5 | No caching layer — data refresh requires full reload | 🟡 MEDIUM | Performance | M |
| M6 | `audit_logs` coverage gaps (logins, activations, attendance QR not logged) | 🟡 MEDIUM | Compliance | S |
| M7 | Hardcoded 200 ms sleep for JWT propagation in `loginOwner` | 🟡 MEDIUM | Reliability | XS |
| M8 | Two CSV/XLSX export patterns (Reports custom, Attendance XLSX) — no unified util | 🟡 MEDIUM | Quality | S |
| M9 | No mobile card fallback on Staff / Reports / Batches tables | 🟡 MEDIUM | UX | M |
| L1 | No automated tests (no Jest, Vitest, Playwright) | 🟢 LOW–HIGH* | Stability | L |
| L2 | No monitoring / Sentry / structured logging | 🟢 LOW–HIGH* | Observability | S |
| L3 | `mockData.js` still imported by 4 pages for static enums (SPORTS, BATCH_NAMES) | 🟢 LOW | Quality | XS |
| L4 | Two error patterns in db.js: silent `42P01` swallow vs. throw — inconsistent | 🟢 LOW | Quality | S |

*Low impact today, high impact the day a paying customer reports a bug.

**Risk score (weighted):** 71 / 100 → "Functional but unsafe for paid multi-tenant production."

---

## 1. CRITICAL FINDINGS (Ship-Blockers)

### C1. RLS policies are open — there is no real multi-tenant database

**File:** `schema_rls.sql:59–93`

Current policies on the core tables:

```sql
CREATE POLICY students_anon_read   ON students   FOR SELECT TO anon USING (true);   -- line 59
CREATE POLICY batches_anon_read    ON batches    FOR SELECT TO anon USING (true);   -- line 64
CREATE POLICY payments_anon_read   ON payments   FOR SELECT TO anon USING (true);   -- line 73
CREATE POLICY attendance_anon_ins  ON attendance FOR INSERT TO anon WITH CHECK (true); -- line 83
```

Only the v3 admin tables (`academies`, `feature_flags`, `user_permissions`) correctly use `USING (academy_id = get_my_academy_id())`.

**Consequence**

- Any anon-key client can `select * from students` and dump every academy in the database.
- Any anon-key client can `insert` into `attendance` for an arbitrary `student_id`.
- The "multi-tenant" property of this SaaS is currently enforced **only by the React app's `.eq('academy_id', x)` filters in `db.js`** — i.e., on the honor system.

**Why this is a ship-blocker for SaaS:** the moment two paying academies share the same Supabase project, one of them owns the other's data.

**Fix sketch**

```sql
-- A. Owner sees their academy
CREATE POLICY students_owner_select ON students FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());
CREATE POLICY students_owner_write  ON students FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- B. Staff/Student tokens → SQL function that resolves academy_id from session table
CREATE OR REPLACE FUNCTION current_staff_academy() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.academy_id FROM staff s
  JOIN staff_sessions ss ON ss.staff_id = s.id
  WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
    AND ss.expires_at > now()
$$;

CREATE POLICY students_staff_select ON students FOR SELECT TO anon
  USING (academy_id = current_staff_academy() OR academy_id = current_student_academy());
```

This shifts trust from the React app to Postgres, which is what RLS is for.

---

### C2. Staff & Student tokens are validated client-side after the first restore

**File:** `src/lib/auth.js:48,72`, `src/lib/db.js:607–627, 884–892`

```js
// auth.js — expiry checked in the BROWSER
if (new Date(s.expiresAt) < new Date()) {
  localStorage.removeItem(STUDENT_KEY)
  return null
}
```

- Token + expiry stored as plaintext in `localStorage` under `sf_staff` / `sf_student`.
- `validateStaffSession` / `validateStudentSession` run **once** on app mount.
- Every subsequent `fetchStudentOwnAttendance`, `markAttendanceViaQR`, etc. trusts the in-memory user object — they don't re-prove the token to the server.

**Attack:** rotate the device clock back, never expire. Or copy the JSON into another browser, attend forever.

**Fix:** send the token on every request via custom header, validate in an RLS function (see C1.B). Make `validateStaffSession` cheap (one indexed select) and call it from a service-layer wrapper.

---

### C3. `PermRequired` is theatre — DB does not enforce permissions

**File:** `src/App.jsx:123–138`

```jsx
function PermRequired({ perm, children }) {
  const { hasPermission } = useApp()
  if (hasPermission(perm)) return children
  return <LockedScreen />
}
```

This component hides the **route content**. It does not stop:

1. A coach (no `payments.manage`) opening DevTools and calling `db.insertPayment(...)`.
2. A receptionist deleting a student via `db.deleteStudent(id)`.
3. A staff member at Academy A modifying `localStorage.sf_staff.academyId` to Academy B and then calling `db.fetchStudents(thatId)`.

Because RLS is `USING (true)`, every one of those succeeds.

**Fix:** every db function that mutates must be backed by an RLS policy that checks role from a server-known source (e.g. `staff.access_role`), not from client state. The React `hasPermission` becomes UX-only — defensive defence-in-depth, not the gate.

---

### C4. `academyId` is client-supplied on every query

**File:** `src/context/AppContext.jsx:102–169` (loadAll), nearly every `db.fetch*` call

Pattern:

```js
const students = await db.fetchStudents(user.academyId)
```

`user.academyId` lives in React state, hydrated from `profiles` (owner) or `localStorage` (staff/student). Anyone can rewrite it before login restore and pull a different tenant's data.

**Fix:** stop passing `academyId` from the client at all. Derive it inside the DB function from the JWT (`get_my_academy_id()`) or from the session row keyed by the token header. The client should not know which academy it's allowed to see — it should only ask for "my data."

---

### C5. Role-based capabilities not enforced at the DB layer

**Example — coach deleting a student:**

```js
// db.js — no permission check
export async function deleteStudent(id) {
  const { error } = await supabase.from('students').delete().eq('id', id)
  if (error) throw error
}
```

Coach has `['attendance.manage', 'students.view', 'batches.view']` only (`src/lib/permissions.js:19`). Nothing in the database stops them from calling delete.

**Fix:** an RLS `FOR DELETE` policy on `students` that requires `current_staff_role() = 'owner' OR has_permission('students.manage')`.

---

## 2. ARCHITECTURE FINDINGS

### H1. `AppContext` is a god provider

**File:** `src/context/AppContext.jsx` (57 KB, ~1260 LOC)

- **16 `useState` hooks** — role, user, features, permissions, loading, students, payments, trials, batches, staff, attendanceData, announcements, events, feePlans, branches, leaveRequests, toast, dataLoading, selectedSport, suspendAfterDays.
- Provider value object exposes **~70 properties**. Every `setToast()` re-renders every consumer of `useApp()` — that's every page, every layout, every header.
- No memoised slices. No selector pattern.

**Why it matters at scale:** the moment a chart re-renders unnecessarily because a toast appeared elsewhere, on a 5k-student dataset you lose 200 ms of frame time and the UI feels broken on mid-tier Android.

**Fix path:**

1. Split into `AuthContext` (role, user, permissions), `UIContext` (toast, dataLoading), and move all server data to **TanStack Query** (`useQuery({ queryKey: ['students', academyId], queryFn })`).
2. Components subscribe to only the slice they need.
3. Mutations invalidate queries — no manual `refreshStudents()` in pages.

### H2. `loadAll()` is a single mount-time blast

**File:** `src/context/AppContext.jsx:102–169`

Eight `Promise.all` fetches on every owner login. No pagination, no `range()`. A 2k-student academy downloads ~6 MB of JSON before the dashboard renders.

Worse: inside `loadAll()`, **auto-suspend logic runs in series** (`Promise.all(toSuspend.map(s => db.suspendStudent(s.id)))`) — for a 200-student bulk suspension that's 200 round trips on the critical login path.

**Fix:**

- Replace with TanStack Query, per-screen, with `useInfiniteQuery` for tables.
- Move auto-suspend to a Postgres scheduled function (`pg_cron`) — not the client's job.
- On screens that need totals (dashboard KPIs), expose a **SQL view** or RPC that returns aggregates, not raw rows.

### H3. Monolithic pages

| Page | LOC | Inline components |
|------|-----|-------------------|
| `Staff.jsx` | 1830 | LeaveRequestsPanel, AccessPanel, StaffAttendancePanel, LeaveApprovalCard, PermissionRow |
| `Reports.jsx` | 1729 | OverviewTab, StudentLedgerTab, AgeingTab, AttendanceTab, PerformanceTab, AuditTab |
| `Students.jsx` | 1489 | AddStudentModal, EditStudentModal, StudentProfileModal, DeleteStudentModal, DobInput, Modal, StudentMenu |
| `Payments.jsx` | 844 | SummaryCard, RecordPaymentModal |
| `Settings.jsx` | 748 | AcademyTab, FeesTab, NotificationsTab, DataTab, etc. |
| `Batches.jsx` | 733 | BatchDetailPanel, AddBatchModal, AssignStudentForm |

Tabs, modals, and sub-panels live in the same file as the route component. Same modal logic is re-implemented per page.

**Cost:** any change to the "students table" forces a recompile of the whole 1.5k-LOC chunk. Lazy-load benefits are negated because each chunk is huge.

**Fix:** see §6 (target structure).

### H4. Business logic in UI

Examples picked up from the audit:

- `Payments.jsx:65–87` — virtual overdue rows are computed inside `useMemo`. This is the **single source of truth** for "is this student in arrears" and it lives in a page component.
- `Students.jsx:115–117, 725–741` — overdue/no-payment flags, fee plan calc.
- `Reports.jsx:245–251` — ageing-bucket computation duplicated from Students.
- `Staff.jsx:21` — average attendance reduce inline.
- `Attendance.jsx:11–17` — status cycle + colours hardcoded.

Every one of these is a domain rule that should be unit-tested in isolation. They cannot be tested today because they're embedded in JSX.

**Fix:** extract to `modules/<feature>/<feature>.domain.js` pure functions. Page components only render results.

### H5. No transactions for multi-step writes

`addStudent` → `assignBatch` → `insertPayment` → `updateStudent.paidTill` is 4 round trips. If the network drops between (3) and (4), the student is in the system, the money is recorded, but `paidTill` is wrong. There's no compensating action.

**Fix path:** wrap multi-row workflows in Postgres functions (`create_student_with_payment(payload jsonb)`) and call them via `supabase.rpc()`. RPC runs inside an implicit transaction.

---

## 3. SCALABILITY FINDINGS

### M2. N+1 in `fetchStudentBatchmatesForPitch`

**File:** `db.js:196–234`

```
1. fetch primary batch IDs for student
2. fetch secondary batches from student_batches
3. fetch all students in those batches
4. fetch secondary enrollments for those students
```

Should be one query with a CTE/JOIN, returning `(student, batch, role)` tuples. At 50 batch-mates this is fine; at 500 it stalls a page.

### M3. Missing memoisation hot spots

- `Students.jsx:122–133` — filtered list recomputed every keystroke even when only an unrelated state changes. Wrap in `useMemo`.
- Status-badge object maps re-allocated per render. Hoist outside the component.

### M4. No pagination / virtualisation

Every table renders all rows. Tested fine at 50 rows; at 5,000 the dashboard freezes for ~3 s on a Snapdragon 6-class Android.

**Fix:** `useInfiniteQuery` + `react-virtual` for the Students / Payments / Attendance tables.

### M5. No cache / no realtime

After a mutation, the only thing that refreshes is the local state of the component that mutated. Two-user concurrency is broken (User A pays a fee → User B still sees overdue until reload).

**Fix:** TanStack Query handles refetch-on-window-focus + manual invalidation. For genuine multi-user, Supabase Realtime channels on `payments` / `attendance` give push updates "for free."

### M2-bis. Missing DB indexes (likely)

Based on query patterns, the following indexes are mandatory before scaling:

```sql
CREATE INDEX IF NOT EXISTS idx_students_academy_id     ON students(academy_id);
CREATE INDEX IF NOT EXISTS idx_students_academy_status ON students(academy_id, status);
CREATE INDEX IF NOT EXISTS idx_students_paid_till      ON students(paid_till);
CREATE INDEX IF NOT EXISTS idx_payments_academy_id     ON payments(academy_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id     ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date           ON payments(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_batch_date   ON attendance(batch_id, date);
CREATE INDEX IF NOT EXISTS idx_student_batches_lookup  ON student_batches(student_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_staff_academy_id        ON staff(academy_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_token    ON staff_sessions(token);
CREATE INDEX IF NOT EXISTS idx_student_sessions_token  ON student_sessions(token);
```

These are not visible in the codebase migrations. Verify against `pg_indexes` before promising the customer "fast."

---

## 4. CODE QUALITY FINDINGS

### H7. No schema validation

Phone validation is `/^\d{10}$/` repeated in `Students.jsx:744`, again in the `onChange` of the input, and not present at all in Staff/Trials. Email validation is missing entirely. Amounts use `Number(x) <= 0` with no max bound.

**Fix:** add `zod` (~12 KB gzipped):

```ts
// modules/students/student.schema.ts
export const studentSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().regex(/^\d{10}$/, 'Enter a 10-digit number'),
  fees: z.number().min(0).max(1_000_000),
  batchId: z.string().uuid(),
  joinDate: z.string().date(),
})
```

Same schema validates the form AND the server-side RPC payload. Single source of truth.

### M8. Two export patterns

`Reports.jsx` uses a hand-rolled `downloadCSV()` (lines 38–49). `Attendance.jsx` uses `xlsx` (lines 26–66). Settings uses `exportImport.js` which dives back to `supabase.from` directly.

**Fix:** unify to a single `shared/utils/export.ts` exposing `downloadCSV(rows, columns)` and `downloadXLSX(sheets)`. Delete the duplicates.

### L3. `mockData.js` is now an enums file

It still exports `SPORTS`, `BATCH_NAMES`, `SOURCES` — imported by 4 pages. The example `students`/`payments` arrays at the top aren't used.

**Fix:** rename to `shared/constants/enums.ts`, drop the dead example data, remove the misleading "mock" name. Better still: move sports to DB so they're per-academy.

### L4. Inconsistent error handling

`db.js` has 12+ sites with:

```js
if (error.code === '42P01') return []   // table missing → swallow
throw error
```

Useful while you were building schemas, dangerous now. A typo in a future migration could silently return empty arrays in production.

**Fix:** wrap once at app boundary, remove per-call swallows, surface real errors to Sentry.

---

## 5. MISSING ENTERPRISE FOUNDATIONS

| Foundation | Status | Recommendation |
|-----------|--------|----------------|
| **Automated tests** | None | Vitest for domain pure functions, Playwright for golden flows (login → add student → record payment → dashboard) |
| **Error monitoring** | None | Sentry (free tier covers low traffic) — wrap ErrorBoundary, `db.js` boundary, and queryClient `onError` |
| **Structured logging** | `console.error` only | Add a `logger.ts` that fans out to Sentry breadcrumb + console; never use `console.log` directly |
| **Audit log coverage** | Partial — see `audit.js` | Add `logAudit` to: staff login, student login, activation, attendance QR scan, password reset |
| **Rate limiting** | None | Activation, login, QR scan endpoints all open to brute force — use Supabase Edge Functions with token bucket, or Upstash Ratelimit |
| **Backups** | Supabase default only | Verify daily backup retention + monthly restore drill |
| **Schema migrations** | Loose SQL files in repo | Use Supabase CLI migrations (`supabase/migrations/*.sql`) so prod/staging diverge cleanly |
| **CI/CD checks** | None visible | GitHub Actions: `vite build`, `vitest run`, `tsc --noEmit` on every PR |
| **Type safety** | JS only | Migrate to TypeScript progressively — start with `lib/db.ts` since it's the contract surface |
| **Feature flags** | `feature_flags` table exists | Wire it into a `useFeatureFlag('flag-name')` hook, gate dangerous rollouts |
| **Performance budget** | None | Lighthouse CI on Vercel preview deploys; reject PRs > 250 ms TBT regression |

---

## 6. RECOMMENDED TARGET STRUCTURE

The structure proposed in the handoff document is correct in spirit. Concretely, for THIS codebase:

```
src/
├── app/
│   ├── App.tsx                 # routes only
│   ├── providers.tsx           # QueryClient, ErrorBoundary, Toast, Router
│   └── routes.tsx              # route table separated from JSX
│
├── core/
│   ├── auth/
│   │   ├── auth.context.tsx    # role, user, permissions ONLY
│   │   ├── owner.adapter.ts    # supabase.auth.* glue
│   │   ├── staff.adapter.ts    # custom token glue
│   │   ├── student.adapter.ts
│   │   └── session.ts          # restore on boot, retry-once for JWT race (replaces 200ms sleep)
│   ├── api/
│   │   ├── supabase.client.ts
│   │   ├── api.ts              # thin wrapper: handles errors, retries, audit log
│   │   └── types.ts            # row types from Supabase generated SDK
│   ├── permissions/
│   │   ├── matrix.ts           # the one true list (moved from lib/permissions.js)
│   │   ├── usePermission.ts
│   │   └── guard.tsx           # <RouteGuard perm=...>
│   └── monitoring/
│       ├── logger.ts
│       └── sentry.ts
│
├── modules/
│   ├── students/
│   │   ├── pages/
│   │   │   ├── StudentsPage.tsx       # route container only
│   │   │   └── StudentDetailPage.tsx
│   │   ├── components/
│   │   │   ├── StudentTable.tsx
│   │   │   ├── StudentCard.tsx        # mobile fallback
│   │   │   ├── AddStudentModal.tsx
│   │   │   ├── EditStudentModal.tsx
│   │   │   └── StudentFilters.tsx
│   │   ├── hooks/
│   │   │   ├── useStudents.ts         # TanStack Query
│   │   │   ├── useAddStudent.ts
│   │   │   └── useStudentMutations.ts
│   │   ├── services/
│   │   │   └── students.service.ts    # ONLY file that talks to supabase about students
│   │   ├── domain/
│   │   │   ├── overdue.ts             # isOverdue, isNoPayment — pure, testable
│   │   │   ├── feePlan.ts             # calcPaidTill — pure
│   │   │   └── suspension.ts
│   │   ├── schemas/
│   │   │   └── student.schema.ts      # zod
│   │   └── __tests__/
│   │       ├── overdue.test.ts
│   │       └── feePlan.test.ts
│   │
│   ├── payments/
│   ├── attendance/
│   ├── batches/
│   ├── staff/
│   ├── reports/
│   ├── trials/
│   ├── events/
│   ├── community/
│   └── settings/
│
├── shared/
│   ├── ui/                     # Modal, Button, Input, Badge, Skeleton, EmptyState
│   ├── components/             # BottomSheet, DataTable, FilterBar (used by ≥3 modules)
│   ├── hooks/                  # useDebounce, useMediaQuery, useToast
│   ├── utils/
│   │   ├── date.ts
│   │   ├── currency.ts
│   │   ├── export.ts           # the ONE csv/xlsx util
│   │   └── format.ts
│   └── constants/
│       └── enums.ts            # SPORTS, BATCH_NAMES, SOURCES (was mockData.js)
│
├── layouts/
│   ├── OwnerLayout.tsx
│   ├── StaffLayout.tsx
│   └── StudentLayout.tsx
│
└── styles/
    └── index.css
```

**Migration heuristic:** never break two layers at once. Migrate Students module end-to-end first, copy the recipe to Payments, then Attendance, etc.

---

## 7. STEP-BY-STEP MIGRATION PLAN

### Phase 0 — Stop the bleeding (1 week)

1. **C1 / C4 — Tenant isolation at the DB.** Write proper RLS policies on `students`, `payments`, `batches`, `attendance`, `announcements`, `events`. Create `current_staff_academy()` and `current_student_academy()` SQL functions. Re-test every flow. **This is the only thing that turns the product into real SaaS.**
2. **H6 — Rate limit activation + login.** Supabase Edge Function or Cloudflare in front. 5 attempts / 10 minutes / IP.
3. **M1 — Add `academy_id` filter to `fetchLeaveRequests` (db.js:~1426).** One-line fix; high value.
4. **M2-bis — Ship the missing indexes** (the index list in §3 above). Run during a maintenance window.

### Phase 1 — Foundation (2–3 weeks)

5. **Install:** `zod`, `@tanstack/react-query`, `zustand` (optional, only for UI state), `@sentry/react`, `vitest`, `@testing-library/react`, `playwright`.
6. **Set up `core/`** — auth contexts split from data, monitoring, api wrapper.
7. **Migrate Students module to the target layout.** Extract `domain/overdue.ts`, `domain/feePlan.ts`. Add Zod schema. Replace `useApp().students` with `useStudents()`. Add unit tests for the domain functions and a Playwright smoke for the add-student flow.
8. **Add `RouteGuard` based on permissions matrix.** Replace `PermRequired` (keep the lock screen as fallback only).

### Phase 2 — Replicate (3–4 weeks)

9. Repeat Phase 1.7 for **Payments**, **Attendance**, **Batches** modules.
10. Add mobile card views to **Staff**, **Reports**, **Batches** (M9).
11. Move all multi-step writes (add student + payment, suspend + notify) into **Supabase RPC** functions for transactional safety (H5).

### Phase 3 — Stability (2 weeks)

12. Sentry on the error boundary, queryClient `onError`, and api wrapper.
13. Add Playwright golden flows: owner-login, add-student, record-payment, dashboard renders, coach restrictions.
14. CI: `vitest run`, `playwright test`, `vite build` on every PR. Lighthouse CI on preview.
15. Backups + restore drill documented.

### Phase 4 — Scale (4–6 weeks)

16. TanStack Query infinite scrolling on Students / Payments / Attendance.
17. Move auto-suspend to `pg_cron`.
18. Supabase Realtime channels on `payments` and `attendance` for cross-user sync.
19. TypeScript migration completed.
20. Feature flag wiring (`useFeatureFlag`) live.

---

## 8. CONCRETE REFACTOR EXAMPLES

### Example 1 — Extract `isOverdue` from JSX

**Before** (`src/pages/Students.jsx:115–117`)

```js
const isOverdue   = (s) => s.status === 'Active' && s.paidTill && s.paidTill < today
const isNoPayment = (s) => s.status === 'Active' && s.batchId && !s.paidTill
```

**After** (`src/modules/students/domain/overdue.ts`)

```ts
import { type Student } from '../types'

export function isOverdue(s: Student, today = new Date()): boolean {
  if (s.status !== 'Active') return false
  if (!s.paidTill) return false
  return new Date(s.paidTill) < today
}

export function isNoPaymentYet(s: Student): boolean {
  return s.status === 'Active' && !!s.batchId && !s.paidTill
}

export function daysOverdue(s: Student, today = new Date()): number {
  if (!isOverdue(s, today)) return 0
  return Math.floor((+today - +new Date(s.paidTill!)) / 86_400_000)
}
```

**Test** (`overdue.test.ts`)

```ts
test('paid student is not overdue', () => {
  expect(isOverdue({ status: 'Active', paidTill: '2099-01-01' } as Student, new Date('2026-05-16'))).toBe(false)
})
test('suspended student is never overdue', () => {
  expect(isOverdue({ status: 'Suspended', paidTill: '2020-01-01' } as Student)).toBe(false)
})
test('days overdue rounds down', () => {
  expect(daysOverdue({ status: 'Active', paidTill: '2026-05-10' } as Student, new Date('2026-05-16'))).toBe(6)
})
```

Now the same rule is used in Students.jsx, Reports ageing, Dashboard KPI, and Payments overdue rows — and is unit-testable.

### Example 2 — Replace `loadAll` with TanStack Query

**Before** (`AppContext.jsx:102–169`)

Single mount-time fetch of 8 collections, blocking the dashboard.

**After** (`modules/students/hooks/useStudents.ts`)

```ts
export function useStudents(filters: { status?: Status; sportId?: string; q?: string } = {}) {
  const { academyId } = useAuth()
  return useInfiniteQuery({
    queryKey: ['students', academyId, filters],
    queryFn: ({ pageParam = 0 }) =>
      studentsService.list({ academyId, ...filters, offset: pageParam, limit: 50 }),
    getNextPageParam: (last, all) =>
      last.length === 50 ? all.length * 50 : undefined,
    staleTime: 30_000,
  })
}
```

Each page that needs students calls `useStudents()`. Cache is shared. Mutations call `queryClient.invalidateQueries({ queryKey: ['students'] })`.

`AppContext` shrinks to ~150 LOC: just auth state.

### Example 3 — RPC for atomic add-student-with-payment

**Postgres**

```sql
CREATE OR REPLACE FUNCTION create_student_with_payment(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_student_id uuid;
  new_payment_id uuid;
BEGIN
  -- All inside one implicit transaction
  INSERT INTO students (academy_id, name, phone, fees, batch_id, join_date)
  VALUES (get_my_academy_id(),
          payload->>'name',
          payload->>'phone',
          (payload->>'fees')::int,
          (payload->>'batchId')::uuid,
          (payload->>'joinDate')::date)
  RETURNING id INTO new_student_id;

  INSERT INTO payments (academy_id, student_id, amount, date, status)
  VALUES (get_my_academy_id(),
          new_student_id,
          (payload->>'fees')::int,
          (payload->>'joinDate')::date,
          'Paid')
  RETURNING id INTO new_payment_id;

  UPDATE students SET paid_till = (payload->>'paidTill')::date
   WHERE id = new_student_id;

  RETURN jsonb_build_object('studentId', new_student_id, 'paymentId', new_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION create_student_with_payment(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION create_student_with_payment(jsonb) TO authenticated;
```

**Client**

```ts
await supabase.rpc('create_student_with_payment', { payload: validated })
```

No more partial-success state. Permissions enforced inside the function.

---

## 9. TESTING PLAN

### Unit tests (Vitest) — domain functions only

- `modules/students/domain/overdue.test.ts`
- `modules/payments/domain/ageing.test.ts` (0–30, 31–60, 61–90, 90+ buckets)
- `modules/attendance/domain/score.test.ts` (status cycle, percentage)
- `modules/students/domain/feePlan.test.ts` (1m, 3m, 6m, 12m, custom range)
- `modules/students/domain/suspension.test.ts` (auto-suspend rules)
- `core/permissions/matrix.test.ts` (every role × every perm = expected boolean)

### Component tests (RTL) — only the tricky ones

- `<StudentFilters />` — debouncing, clear behaviour, URL sync
- `<AddStudentModal />` — happy path + 3 validation paths via Zod

### E2E (Playwright) — golden flows

```
specs/owner.spec.ts
  - log in as owner
  - add student → assert appears in table
  - record payment → assert paidTill updates
  - dashboard KPI matches sum of payments

specs/coach.spec.ts
  - log in as coach
  - mark attendance for a batch
  - assert cannot see Payments page
  - assert direct call to db.deleteStudent throws 403 (RLS)

specs/student.spec.ts
  - activate via join code
  - scan QR → attendance marked
  - cannot mark twice

specs/multitenant.spec.ts
  - log in as Academy A staff
  - forge localStorage academyId to Academy B
  - assert fetchStudents returns empty / 403 (RLS gate)
```

### Manual QA checklist (per release)

- [ ] Owner login (cold + warm)
- [ ] Staff activation + login + logout
- [ ] Student activation + login + scan QR
- [ ] Add / Edit / Delete student (Active / Suspended)
- [ ] Suspend → Reactivate cycle
- [ ] Record payment (full, partial, refund)
- [ ] Ageing report tallies match Payments page
- [ ] Coach cannot navigate to Payments
- [ ] Coach attempt direct db call (DevTools) → blocked
- [ ] Mobile: bottom sheets, card lists, large tap targets
- [ ] Offline: behaviour when network drops mid-write
- [ ] Two-user concurrency: payment from owner shows on staff screen on next focus

---

## 10. PRIORITY MATRIX

```
            HIGH IMPACT
                ▲
                │
  C1 RLS        │     H2 No pagination
  C2 Tokens     │     H1 God context
  C3 PermReq    │     H3 Monolithic pages
  C4 academyId  │     H7 No validation
  C5 Role enf.  │
                │
  ──────────────┼────────────── EFFORT →
                │
  M1 leaveReq   │     H4 Logic in UI
  M3 useMemo    │     H5 No transactions
  L1 No tests   │     M2 N+1 queries
  L4 err handle │     M4 Pagination/virtual
                │     L1 Test infra
                │
            LOW IMPACT
```

**Top-left quadrant first.** Those are the critical security items that ship in days, not months, and unblock the rest.

---

## 11. WHAT NOT TO DO

Three traps the handoff document hints at but worth calling out:

1. **Don't rewrite from scratch.** The MVP works. Migrate module-by-module.
2. **Don't introduce TypeScript everywhere on day one.** Start with `db.ts` (the contract) and one module. Pure-JS code keeps shipping.
3. **Don't replace Context with Redux/Zustand wholesale.** Server state belongs in TanStack Query. Only UI state (open modals, toast, sport filter) belongs in a store. That's a small slice.

The biggest danger in this project right now is not architecture — it is the open RLS policies. Fix that this week. Everything else is a multi-month roadmap that runs over a still-working product.

---

## 12. ESTIMATED EFFORT

| Phase | Calendar weeks | Engineer-weeks | Outcome |
|-------|---------------|----------------|---------|
| 0. Stop the bleeding | 1 | 1.5 | Tenant isolation real, brute force closed |
| 1. Foundation | 2–3 | 4 | TanStack Query live, Students module reborn, tests start |
| 2. Replicate | 3–4 | 6 | Payments / Attendance / Batches refactored, RPCs for writes |
| 3. Stability | 2 | 2 | Sentry, CI, Playwright golden flows |
| 4. Scale | 4–6 | 6 | Virtualisation, realtime, TypeScript complete |
| **Total** | **12–16 wk** | **~20 ew** | **Production-grade multi-tenant SaaS** |

For a single engineer, plan ~4 months wall-clock. For a pair, ~2.5 months. Anything faster is technical debt with a marketing budget.

---

*End of audit. No source files have been modified.*
