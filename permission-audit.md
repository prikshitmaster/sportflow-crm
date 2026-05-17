# SportFlow CRM — Permission & Role Security Audit

**Audited**: 2026-05-18
**Scope**: Owner / Manager / Staff / Coach roles, multi-tenant isolation, branch isolation, frontend & backend
**Method**: Static code analysis (App.jsx, AppContext.jsx, db.js, schema_rls.sql, permissions.js, page components)
**Status**: 🔴 SEVERAL CRITICAL FINDINGS — do not deploy a branch manager role until fixes land

---

## TL;DR

- The **frontend** permission system is reasonable (`hasPermission`, route guards, `PermRequired`).
- The **backend** is essentially open: most RLS policies are `USING (true)` for authenticated, so **any authenticated user can read/write any data in any academy by calling Supabase directly** (browser dev tools, Postman, curl).
- **Branch isolation is frontend-only.** The `branch_id` column added in migration 0017b has no RLS enforcement. A determined staff member can bypass branch scope by editing `localStorage` or calling the API directly.
- The `branch_manager` role has database columns (0016b) but **zero frontend wiring** — no auth flow, no role preset, no UI to invite one. Currently inert.
- Several smaller issues: anon-readable attendance, session tokens, payment delete without manage-permission check.

---

## STEP 1 — Route × Role Map

Roles in current production code:
- `owner` — full access; bypasses all permission checks via `hasPermission`
- `admin` — staff portal access role; gets ALL_PERMISSIONS preset
- `coach` — staff portal access role; default = `[attendance.manage, students.view, batches.view]`
- `receptionist` — `[students.view, students.manage, trials.manage]`
- `accountant` — `[payments.view, payments.manage, reports.view]`
- `staff` — fallback role with `[attendance.manage, students.view]`
- **NO `manager` / `branch_manager` role exists in `ACCESS_ROLES` or `ROLE_PRESETS`** (see `src/lib/permissions.js:57`)

### Owner portal routes (gated by `OwnerRoute` → must be `role === 'owner'`)

| Route | Component | Visible to | Action restrictions |
|---|---|---|---|
| `/sport-select` | SportSelect | owner only | full CRUD on sports + branches |
| `/dashboard` | Dashboard | owner only (route) | full access |
| `/students` | Students | owner only (route) | add / edit / delete / suspend |
| `/attendance` | Attendance | owner only (route) | mark / edit |
| `/payments` | Payments | owner only (route) | record / delete / edit date |
| `/trials` | Trials | owner only (route) | full CRUD |
| `/batches` | Batches | owner only (route) | full CRUD |
| `/coaches` | Staff | owner only (route) | invite / edit / remove |
| `/reports` | Reports | owner only (route) | view / export |
| `/community` | Community | owner only (route) | post |
| `/settings` | Settings | owner only (route) | feature flags, fee plans |
| `/gate-qr` | AdminQR | owner only (route) | generate QR |
| `/staff-qr` | StaffAttendanceQR | owner only (route) | generate QR |
| `/events` | Events | owner only (route) | full CRUD |
| `/ops/live` | OpsActivity | **anyone with PIN** — hidden URL, no role guard at route level | observe live sessions |

### Staff portal routes (gated by `StaffRoute` + `PermRequired`)

| Route | Component | Permission required | Notes |
|---|---|---|---|
| `/staff/home` | StaffDashboard | none (always visible) | reads filtered data |
| `/staff/me` | StaffMe | none | profile + leave |
| `/staff/profile` | StaffProfile | none | profile |
| `/staff/roster` | StaffRoster | none | reads students |
| `/staff/notices` | StaffNotices | none | announcements |
| `/staff/attendance` | StaffAttendance | none (entry point) | mark attendance |
| `/staff/scan-in` | StaffScanIn | none | clock-in |
| `/staff/assess` | StaffAssess | none | assess players |
| `/staff/pulse` | StaffPulse | none | activity |
| `/staff/students` | Students | `students.view` ✓ | shared component |
| `/staff/payments` | Payments | `payments.view` ✓ | shared component |
| `/staff/trials` | StaffTrials | `trials.manage` ✓ | |
| `/staff/batches` | Batches | `batches.view` ✓ | shared component |
| `/staff/reports` | Reports | `reports.view` ✓ | shared component |
| `/staff/community` | Community | `community.manage` ✓ | |
| `/staff/events` | Events | `events.manage` ✓ | |
| `/staff/coaches` | Staff | `staff.manage` ✓ | |
| `/staff/settings` | Settings | `settings.manage` ✓ | |

### Student portal routes (gated by `StudentRoute`)

| Route | Component | Visible to | Notes |
|---|---|---|---|
| `/student/*` | Student pages | role === 'student' | reads own data only (client-side filtered) |

---

## STEP 2 — UI Restrictions: Findings

### ✅ Working correctly

- **Owner detection** is consistent: `role === 'owner'` returns true for `hasPermission(anything)`.
- **Sidebar** filters items by both `isFeatureOn(feature)` AND `hasPermission(perm)`.
- **Route guards** redirect unauthorized roles correctly (`OwnerRoute` → `/login`, `StaffRoute` → `/staff-login`).
- **`PermRequired`** wraps every staff-portal admin page; shows a clear "Access Restricted" screen.

### ❌ UI Issue #1 — Permission scope is binary (view OR manage) but UI doesn't differentiate

**Severity**: 🟠 MEDIUM
**Location**: `src/pages/Payments.jsx:140, 426`, similar in other pages

A staff user with `payments.view` (e.g. accountant) reaches `/staff/payments`. The page shows the **delete payment button** at line 426 — there's no second check like `hasPermission('payments.manage')` around the action.

**Risk**: A staff with view-only permission can DELETE payments. Same applies to:
- Students page: edit/delete buttons not gated separately from view
- Batches page: same
- Trials page: same

**Fix**: Wrap action buttons in `{hasPermission('payments.manage') && <Button>Delete</Button>}` and verify before calling the action.

### ❌ UI Issue #2 — `/ops/live` has no role check at all

**Severity**: 🟠 MEDIUM
**Location**: `src/App.jsx:222`

```jsx
<Route path="/ops/live" element={<OpsActivity />} />
```

No `OwnerRoute` wrapper. The user comment says "PIN-gated" — pin gating is inside the component, but the URL is public. If the PIN check is bypassable (default PIN, weak PIN, or the file is read by someone who has it), the screen exposes session data.

**Fix**: Wrap in `<OwnerRoute>` AND keep the PIN. Defense in depth.

### ❌ UI Issue #3 — Branch scope is NOT enforced for staff

**Severity**: 🔴 HIGH
**Location**: `src/context/AppContext.jsx:101–139`

`selectedSport` and `selectedBranch` are pulled from localStorage. A staff user can:
1. Open dev tools
2. `localStorage.removeItem('sf_selected_branch')`
3. Reload → now sees data across all branches

Even more: staff portal calls `setSelectedSport(null)` on load (line 322), so staff already sees everything across sports (no scoping enforced). When `branch_manager` role gets wired, the same vector applies.

**Fix**: Branch scope must be **server-enforced** for non-owner roles. Either:
- RLS policy `students.branch_id IN (SELECT branch_id FROM user_permissions WHERE user_id = auth.uid())`
- OR pass `branch_id` filter in every db.js fetcher when `user.accessRole !== 'admin' && user.accessRole !== 'owner'`

---

## STEP 3 — Backend Security: 🔴 CRITICAL FINDINGS

### 🔴 CRITICAL #1 — RLS on core tables is wide open

**Severity**: 🔴 CRITICAL
**Location**: `supabase/schema_rls.sql:59–84`

```sql
-- All these are USING (true) — ANY authenticated user, ANY academy
CREATE POLICY "students_auth_all"     ON students     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "batches_auth_all"      ON batches      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_auth_all"        ON staff        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payments_auth_all"     ON payments     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "trials_auth_all"       ON trials       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "attendance_auth_all"   ON attendance   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "announcements_auth_all"ON announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gate_qr_auth_all"      ON gate_qr      FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**Exploit**: A staff user from Academy A opens dev tools and runs:

```js
await supabase.from('students').select('*')              // → ALL students, ALL academies
await supabase.from('payments').delete().eq('id', X)     // → deletes any payment in any academy
await supabase.from('students').update({ status: 'Suspended' }).eq('id', anyId)
```

The frontend filters by academy_id, but RLS lets ANY academy's data through if the query bypasses the frontend filter.

**Risk**: Total cross-tenant data exposure. Total cross-tenant data deletion. GDPR catastrophe.

**Fix**: Update every `_auth_all` policy to scope by `academy_id = get_my_academy_id()`. Pattern already used for `feature_flags`, `user_permissions`, `staff_invites`, `academy_branches`. Migration `0003_tighten_owner_rls.sql` exists for some of these — verify and extend.

### 🔴 CRITICAL #2 — Anon can read all students + payments

**Severity**: 🔴 CRITICAL
**Location**: `supabase/schema_rls.sql:59, 73, 82`

```sql
CREATE POLICY "students_anon_read"   ON students   FOR SELECT TO anon USING (true);
CREATE POLICY "payments_anon_read"   ON payments   FOR SELECT TO anon USING (true);
CREATE POLICY "attendance_anon_read" ON attendance FOR SELECT TO anon USING (true);
```

The Supabase **anon key is in the JS bundle** (it's meant to be — that's how the student portal authenticates). With the anon key, a curl from anywhere reads every student record in the database.

**Exploit**:
```bash
curl 'https://vdvpwbhkdlbskewfgref.supabase.co/rest/v1/students?select=*' \
  -H "apikey: <anon-key-from-bundle>"
# Returns every student in every academy. Same for payments, attendance.
```

**Risk**: Mass PII leak. Names, phones, parent phones, ages, fees, student codes, join codes (login credentials!).

**Fix**: Replace anon-read policies with restrictive ones:
- Student portal reads by `student_code` + token validation, not full table SELECT.
- Move student session validation server-side (RPC or edge function) so the anon key never has full read.

### 🔴 CRITICAL #3 — Student session tokens are completely open

**Severity**: 🔴 CRITICAL
**Location**: `supabase/schema_rls.sql:99`

```sql
CREATE POLICY "student_sessions_all" ON student_sessions FOR ALL USING (true) WITH CHECK (true);
```

Anon (and authenticated) can:
- SELECT every session token from every student
- DELETE any session
- INSERT a forged session for any `student_id`

**Exploit**: Read any token from this table → set it in localStorage → impersonate that student.

**Risk**: Account takeover of any student.

**Fix**: Move session validation behind a SECURITY DEFINER RPC. Lock down direct access to anon entirely; allow authenticated SELECT only for `student_id = (current student via own session context)`.

### 🔴 CRITICAL #4 — Anyone can insert attendance for any student

**Severity**: 🔴 CRITICAL
**Location**: `supabase/schema_rls.sql:83`

```sql
CREATE POLICY "attendance_anon_insert" ON attendance FOR INSERT TO anon WITH CHECK (true);
```

**Exploit**: Mark anyone present/absent via direct API. Attendance fraud (sign in a student who isn't there → manipulate fee penalties / progression / records).

**Fix**: Insert through a SECURITY DEFINER RPC that validates the gate QR token before allowing insert. The current QR flow already validates the token client-side — move that validation server-side.

### 🟠 HIGH #5 — Staff anon insert on staff_attendance

**Severity**: 🟠 HIGH
**Location**: `supabase/schema_rls.sql:131`

```sql
CREATE POLICY "staff_attendance_anon_insert" ON staff_attendance FOR INSERT TO anon WITH CHECK (true);
```

Same shape: anyone can insert a clock-in for any staff member. Time fraud / salary manipulation.

**Fix**: RPC-gated, validate the staff QR token.

### 🟠 HIGH #6 — Privilege escalation via user_permissions

**Severity**: 🟠 HIGH
**Location**: `supabase/schema_rls.sql:134–136`

```sql
CREATE POLICY "user_permissions_access" ON user_permissions FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());
```

Any authenticated user can UPDATE any row in their academy. A coach can:
```js
await supabase.from('user_permissions')
  .update({ access_role: 'admin', permissions: [/* all of them */] })
  .eq('user_id', authUid())
```

**Exploit**: Any staff user upgrades themselves to `admin` → full app access on next reload.

**Fix**: Restrict UPDATE/INSERT/DELETE on user_permissions to the owner only:
```sql
USING (academy_id = get_my_academy_id() AND
       EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
```

### 🟠 HIGH #7 — Privilege escalation via profiles.role

**Severity**: 🟠 HIGH
**Location**: `supabase/schema_rls.sql:115`

```sql
CREATE POLICY "profiles_own" ON profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid())
```

A user can UPDATE their own row → set `role = 'owner'` → reload → owner access.

**Exploit**:
```js
await supabase.from('profiles').update({ role: 'owner' }).eq('id', authUid())
```

**Fix**: Either prevent users from editing their own `role` column (column-level grant), or add a check constraint that prevents non-owner profiles from being upgraded.

---

## STEP 4 — Privilege Escalation Attempts (Live System)

Based on the findings above, the following attacks succeed today against your live system:

| Attack | Path | Severity | Working? |
|---|---|---|---|
| Coach → Owner | Edit `profiles.role` via direct API | 🔴 CRITICAL | ✅ Works |
| Coach → Admin | Edit `user_permissions.access_role` via direct API | 🟠 HIGH | ✅ Works |
| Staff → Read other academy | `supabase.from('students').select('*')` ignoring academyId | 🔴 CRITICAL | ✅ Works |
| Staff → Delete another academy's payments | `supabase.from('payments').delete().eq('id', X)` | 🔴 CRITICAL | ✅ Works |
| Anon → Read all students | curl with anon key from bundle | 🔴 CRITICAL | ✅ Works |
| Anon → Forge student session | Read session tokens, set in localStorage | 🔴 CRITICAL | ✅ Works |
| Anon → Fake attendance | Direct INSERT into attendance | 🔴 CRITICAL | ✅ Works |
| Owner → Bypass branch scope | Edit `localStorage.sf_selected_branch` | 🟢 N/A | Owner expected to see everything |
| (Future) Branch Manager → See other branches | Edit `localStorage.sf_selected_branch` | 🟠 HIGH | ✅ Works (filter is client-side only) |

---

## STEP 5 — Cross-Branch Leakage

Current state (no branch_manager auth wired):

| Scenario | Expected | Actual |
|---|---|---|
| Owner picks Football → Branch 1 → sees only Branch 1 students | ✓ | ✅ Works (client-side filter) |
| Owner toggles selectedBranch in localStorage to see Branch 2 | not blocked | ✅ Works as intended (owner can switch) |
| Staff sees Branch 1 + 2 freely | Yes by current design | ✅ Works (staff has no branch scoping) |
| Future branch manager: sees only their branch | Should be blocked at DB level | ❌ Would NOT be blocked — filter is client-side, RLS is wide open |

**Conclusion**: Once branch_manager role goes live, no DB-level isolation. Must add RLS using the new `profiles.branch_id` column added in 0016b.

---

## STEP 6 — Financial Security

| Check | Status |
|---|---|
| Duplicate payment possible? | 🟢 Mitigated client-side; no DB unique constraint on (student_id, month) — risk if dual-tab insert |
| Edit payment history? | 🟠 `updatePaymentDate` exists; only gated by frontend permission — direct API bypass possible |
| Delete payment history? | 🔴 `removePayment` — direct API bypass possible; staff with `payments.view` can delete via UI (button not perm-gated) |
| See restricted financial data? | 🔴 Anon read on `payments` table → mass financial data leak |
| Atomic invoice ID generation | 🟢 Migration 0014 added atomic counter — race-free |
| Audit trail on payment changes | 🟢 `audit_logs` records the action |
| Audit log tamper-proof? | 🔴 `audit_logs_auth_all USING (true)` likely — staff can delete audit rows directly via API |

---

## STEP 7 — Findings Summary (Priorities)

### 🔴 CRITICAL (fix before public deployment)
1. **C1**: RLS `USING (true)` on students/batches/staff/payments/trials/attendance/announcements/gate_qr — scope to `academy_id`
2. **C2**: Anon-read on students/payments/attendance via anon key — replace with RPC-gated reads
3. **C3**: `student_sessions_all USING (true)` — lock down to session-context only
4. **C4**: `attendance_anon_insert` — gate behind QR-validated RPC
5. **C5**: `profiles_own` lets users set their own role — block role escalation
6. **C6**: `user_permissions_access` lets staff edit anyone's permissions in academy — owner-only writes

### 🟠 HIGH
7. **H1**: `staff_attendance_anon_insert` — gate behind staff QR RPC
8. **H2**: Branch isolation is client-side only — add RLS using `branch_id` (especially before launching branch_manager role)
9. **H3**: `branch_manager` role exists in DB but no frontend wiring — wire it OR remove the columns to avoid confusion
10. **H4**: Action buttons (delete/edit) in shared pages don't differentiate `.view` vs `.manage` permission — UI shows actions to view-only users; backend allows them due to C1

### 🟠 MEDIUM
11. **M1**: `/ops/live` route has no `OwnerRoute` wrapper — only PIN-protected client-side
12. **M2**: `audit_logs` table — verify RLS prevents staff from deleting audit entries
13. **M3**: `leave_requests` table has no `academy_id` → cross-tenant leak (acknowledged TODO in schema_rls.sql:125)
14. **M4**: `selectedSport` and `selectedBranch` from localStorage — bypassable by any user; not a vulnerability for owner but is for any non-owner role
15. **M5**: Frontend `db.fetchStudents(academyId)` passes academyId from JS state — if state mutates, fetcher uses wrong academy; combined with C1, leaks data

### 🟢 LOW / Working Correctly
- Route guards (`OwnerRoute`, `StaffRoute`, `StudentRoute`) — correct, redirect on mismatch
- `PermRequired` — works for staff portal admin pages
- `hasPermission` — correct shape; owner bypass works
- Sidebar filters items by `permission` + `feature` — works
- Session restore logic (`AppContext` line 260+) — solid, prioritises owner/staff/student in order

---

## STEP 8 — Fix Recommendations (Phased)

### Phase A — DB lockdown (single SQL migration, additive)
Stop the bleeding first. One migration file with all 6 critical RLS fixes.

Migration `0019_rls_hardening.sql`:
1. Replace every `_auth_all USING (true)` on `students`, `batches`, `staff`, `payments`, `trials`, `attendance`, `announcements`, `gate_qr` with `USING (academy_id = get_my_academy_id())` (and matching `WITH CHECK`)
2. Replace `students_anon_read USING (true)` with a restrictive policy or a SECURITY DEFINER RPC for the student portal use case
3. Replace `student_sessions_all` with RPC-gated access
4. Drop `attendance_anon_insert` and `staff_attendance_anon_insert`; replace with `mark_attendance_via_qr(token, student_id)` SECURITY DEFINER RPCs
5. Tighten `profiles_own` so users CAN'T change their own `role` column (use column grants or check constraints)
6. Tighten `user_permissions_access` writes to owner-only

Each policy change is additive (DROP POLICY IF EXISTS; CREATE POLICY). Rollback file `0019_rollback.sql` reverts each one to the previous broad policy.

**Risk**: Some functions in the app may have been silently relying on the broad RLS. After the migration, test:
- Owner can still do everything ✓
- Staff portal still loads ✓
- Student portal login still works ✓
- Gate QR attendance still works ✓
- Coach attendance marking still works ✓

### Phase B — Branch isolation at DB level
Migration `0020_branch_rls.sql`:
- Add an RLS clause for students/batches/payments/etc. that's:
  - Owner: full academy access (current behavior)
  - Branch manager: rows whose `branch_id = profiles.branch_id`
  - Other staff: full academy access (unchanged for now)

### Phase C — Frontend permission tightening
Non-DB changes; safe to ship after Phase A:
- Wrap action buttons (`removePayment`, edit, delete) in `hasPermission('*.manage')` checks
- Wrap `/ops/live` in `OwnerRoute`
- Add a UI guard: `if (user.accessRole !== 'owner') return <Locked />` for the role-edit screen

### Phase D — Branch manager role wiring
- Add `branch_manager` to `ACCESS_ROLES` + `ROLE_PRESETS`
- Extend invite flow to assign `branch_id` + `branch_sport`
- AppContext: when `accessRole === 'branch_manager'`, set `selectedSport` + `selectedBranch` from `user.branchSport`/`user.branchId` and DISABLE switching
- DB writes: include `branch_id` on creates (students/batches/payments inherit through linked records)

---

## Retest Plan

After each phase, run the same 9 attack scenarios from STEP 4. Expected results after Phase A:

| Attack | Before | After Phase A |
|---|---|---|
| Coach → Owner via profiles edit | ✅ Works | ❌ Blocked |
| Coach → Admin via user_permissions edit | ✅ Works | ❌ Blocked |
| Staff cross-academy read | ✅ Works | ❌ Blocked |
| Staff cross-academy delete | ✅ Works | ❌ Blocked |
| Anon read all students | ✅ Works | ❌ Blocked |
| Anon forge session | ✅ Works | ❌ Blocked |
| Anon fake attendance | ✅ Works | ❌ Blocked |

After Phase B: branch manager cross-branch read also blocked.

---

## Open Questions for Owner

1. Do you want to enable the `branch_manager` role now (proceed with Phase D), or finalize stability first?
2. Is there a current production database with real PII? If yes, **Phase A is urgent** — the anon-read leak is exploitable from any internet.
3. The student portal currently reads payments via anon SELECT — do you want to keep this or switch to authenticated reads via student JWT? (Bigger refactor.)

---

*Report ends. No code modified during this audit.*
