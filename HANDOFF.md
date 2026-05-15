# SportFlow CRM — Handoff Document
**Date:** 2026-05-15  **Branch:** main

---

## What Was Built (Cumulative — All Features)

### 1. Core CRM (Foundation)
- Three-portal system: Owner (`/login`), Staff (`/staff-login`), Student (`/student-login`)
- Students: full CRUD, suspend/reactivate, auto-suspend on 3+ days overdue
- Payments: record, delete, mark paid, inline date edit, overdue virtual rows
- Attendance: owner monthly grid + staff per-session + student self-view + QR gate scan
- Batches: create/edit/delete, assign coaches
- Trials: pipeline management (Scheduled → Completed → Converted)
- Staff: HR records, photo upload, invite portal flow (7-day token)
- Events: calendar, status management
- Community: announcements
- Settings: feature flag toggles
- Reports: Overview, Financial (ERP AR), Performance, Audit Log tabs

---

### 2. Performance / Assessment System

**SQL** — `supabase/schema_performance.sql` *(MUST RUN IN SUPABASE)*
- `skill_assessments` table (student_id BIGINT, scores JSONB, assessed_month TEXT)
- `student_badges` table (reserved for future badge logic)
- Open RLS policies for anon + authenticated

**Shared lib** — `src/lib/performance.js`
- `FOOTBALL_CATEGORIES` — 4 groups × 28 skills (Technical, Tactical, Athleticism, Personality)
- `SPORT_CATEGORIES` map — Football wired, Tennis/Squash/Table Tennis reserved (null)
- `SKILL_SHORTS` — unique short labels for radar chart axes
- Helpers: `getCategoryAvg`, `getOverallScore`, `getTier`, `buildMonthOpts`, `monthLabel`
- Tier scale: Bronze 0–39 · Silver 40–59 · Gold 60–79 · Elite 80–100

**Coach: `/staff/assess`** — `src/pages/staff/StaffAssess.jsx`
- Tab 1 "Assess Players": month + batch picker → student list (assessed ✓ / pending ○) → bottom-sheet form
- Assessment form: 4 collapsible category sections, sliders 0–100 per skill, category avg shown live
- Re-submit prompt: "Update existing" or "Overwrite from scratch"
- Tab 2 "View Stats": search any player → lazy-load their latest assessment → category bars inline

**Coach Dashboard** — `src/pages/staff/StaffDashboard.jsx`
- "Player Stats" section: search + top 5 performers from coach's batches (fetched on mount)
- Tap any player → navigates to `/staff/assess`

**Student: `/student/stats`** — `src/pages/student/StudentStats.jsx`
- Gradient hero (indigo→purple), white score ring with glow
- Radar chart: default 4-category axes; click tab → per-skill axes in category colour
- Category pill tabs (active fills with category colour + shadow)
- Skills panel: gradient progress bars, delta chips vs last month, coach note
- History line chart (multi-month)
- Tier scale card with "You" badge

**Owner: Reports → Performance tab** — `src/pages/Reports.jsx`
- KPIs: assessed count, avg score, pending count
- Top players leaderboard (up to 20)
- Batch performance heatmap (avg score per batch, colour-coded)
- Not-assessed list (active students with no assessment this month)

**Navigation wired:**
- Coach bottom nav: Home · Attend · **Assess** · Notices · Me
- Student bottom nav: Home · Scan · Attend · **Stats** · Fees · Notice
- Routes: `/staff/assess`, `/student/stats`

---

### 3. Multi-Batch Enrolment System

**SQL** — `supabase/schema_student_batches.sql` *(MUST RUN IN SUPABASE)*
- `student_batches` junction table (student_id BIGINT, batch_id BIGINT, UNIQUE constraint)
- Open RLS policies for anon + authenticated
- Back-fill migration: existing primary-batch students get a row automatically on first run

**DB functions added to `src/lib/db.js`:**
- `fetchBatchEnrolments(batchId)` — enrolled students for a batch
- `assignStudentToBatch(studentId, batchId, batchName, academyId)` — upsert on conflict
- `unassignStudentFromBatch(studentId, batchId)` — delete
- `fetchAllStudentBatches(academyId)` — all enrolments for academy

**`src/pages/Batches.jsx`** — BatchDetailPanel:
- Search bar to find and assign any student
- Assign/Remove buttons update `student_batches` + call `updateBatchEnrolled` (DB) + `enrolledAdj` local state overlay
- "Multi" badge for students in this batch via junction table
- "Primary" badge for students whose primary batch matches

**`src/pages/Students.jsx`** — Add Student modal:
- "Additional Batches" toggle-chip section
- After `addStudent()` returns new student, calls `assignStudentToBatch()` for each selection

**`src/pages/staff/StaffAttendance.jsx`** — Roster:
- `fetchBatchEnrolments(batchId)` on batch selection → `mbStudentIds` Set
- Roster includes primary-batch students AND multi-batch-enrolled students

---

### 4. Audit Log System

**SQL** — `supabase/schema_audit_logs.sql` *(MUST RUN IN SUPABASE)*
- `audit_logs` table with actor, action, entity, changes (JSONB diff), note
- Index on `(academy_id, created_at DESC)`
- Open RLS policies for anon + authenticated

**Shared lib** — `src/lib/audit.js`
- `ACTIONS` — 15 action key constants
- `ACTION_LABELS` — human-readable map
- `ENTITY_COLORS` + `ROLE_COLORS` — UI badge colours
- `diffObjects(oldObj, newObj, fields)` — field-level diff, returns only changed fields
- `logAudit({actor, action, entityType, entityId, entityName, changes, note, academyId})` — fire-and-forget, never throws

**13 instrumented functions in `AppContext.jsx`:**
1. `addStudent` → `student.add`
2. `updateStudent` → `student.edit` with `diffObjects` diff
3. `deleteStudent` → `student.delete`
4. `suspendStudent` → `student.suspend`
5. `reactivateStudent` → `student.reactivate`
6. `resetStudentPasswordAdmin` → `student.password_reset`
7. `addPayment` → `payment.add` (amount, months, mode)
8. `removePayment` → `payment.remove` (amount, month label)
9. `markPaymentPaid` → `payment.mark_paid` (mode)
10. `addBatch` → `batch.add` (sport, capacity, coach)
11. `updateBatch` → `batch.edit` with `diffObjects` diff
12. `deleteBatch` → `batch.delete`
13. `updateBatchCoach` → `batch.coach_assign` (old→new coach)

**`src/pages/Reports.jsx`** — Audit Log tab:
- Fetches `fetchAuditLogs(academyId)` (guarded for missing table)
- Date-grouped timeline with `groupByDate()`
- Filter by entity type: All / student / payment / batch
- Search by actor name or entity name
- Refresh button
- `AuditEntry` component: actor avatar, role badge, action label, entity name, relative time, expandable diff (old→new)

---

### 5. BatchCard Mobile-Friendly Redesign

**Problem**: `rounded-full` badge + long batch names (e.g. "Evening Under 20 Advance") created oval shapes that broke mobile layout at 3-column grid.

**Fix in `src/pages/Batches.jsx`:**
- Color accent bar at top of card (`h-1` stripe, 5 hex colors)
- Plain bold batch name (no oval badge)
- Grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
- Capacity bar + coach avatar use matching accent hex color
- Entire card is clickable (`onClick` on wrapper)

---

### 6. Financial Tab (ERP Accounts Receivable)

`Reports.jsx` Financial tab:
- KPI cards: Total Outstanding, 90+ days Overdue, Current (≤30 days), Collected This Month
- Ageing buckets: 0–30 / 31–60 / 61–90 / 90+ days past due
- Includes Suspended students (not just Active) in outstanding totals
- Status badges: Active (green), Suspended (red), Overdue (amber)
- Month + status filters
- 6-month trend chart (collected vs outstanding)
- Collection rate metric
- CSV export

---

## Known Issues / Still To Fix

- `assessed_by` (staff_id) in `skill_assessments` stored from `user.id` — verify this is a BIGINT not UUID for staff
- `student_badges` table exists but badge award logic not yet built
- Three SQL files still need to be run in Supabase (see below)

---

## SQL Files That MUST Be Run in Supabase

Run in this order if not already done:
1. `supabase/schema_performance.sql` — performance system tables
2. `supabase/schema_student_batches.sql` — multi-batch junction table
3. `supabase/schema_audit_logs.sql` — audit trail table

---

## Next Goals / Planned Features

### Full System Testing Pass
| Area | What to test |
|---|---|
| Staff activation | Join code → set password → login → permissions work |
| Staff profile | Photo upload, edit name/phone/age saves |
| Attendance (staff) | Mark session, coach sees own record, multi-batch roster includes correct students |
| Leave requests | Submit → owner approves/rejects → staff sees update |
| Student add | Batch auto-fill, fee plan auto-fill, additional batches assign |
| Payments | Add payment, auto-amount from fee plan, overdue detection |
| Suspension | Trigger after X days, reactivate, ageing report updates |
| Reports | Ageing buckets, trend charts, CSV export |
| Financial tab | AR view, outstanding KPIs, filters show Suspended students |
| Performance tab | Assessments show, leaderboard correct, batch heatmap renders |
| Audit Log tab | Actions appear after CRUD operations, diff expands correctly |
| Multi-batch | Assign in BatchDetailPanel, appears in StaffAttendance roster |
| QR scan-in | Staff QR clock-in records to `staff_attendance` |

### Performance Dashboard Sections (Discussed, Not Built)
#### Owner Dashboard (`/dashboard`)
- Leaderboard: all students ranked by overall score, filterable by batch
- Batch comparison: batch avg scores side by side
- Team Builder: top N students overall or by category
- **Category Cards** (agreed format): Best Technical / Tactical / Fitness / Mental — name, score, tap for full list

#### Coach Dashboard (`/staff/home`)
- Full batch ranking (sorted by score)
- Top player per category within their batch
- One-tap to assess

---

## Key Files Quick Reference

| What | File |
|---|---|
| All auth + state + audit calls | `src/context/AppContext.jsx` |
| DB functions | `src/lib/db.js` |
| Audit helpers | `src/lib/audit.js` |
| Performance helpers | `src/lib/performance.js` |
| Permissions | `src/lib/permissions.js` |
| Routes + guards | `src/App.jsx` |
| Owner: Students + multi-batch add | `src/pages/Students.jsx` |
| Owner: Batches + multi-batch panel | `src/pages/Batches.jsx` |
| Owner: Reports (all 4 tabs) | `src/pages/Reports.jsx` |
| Staff portal layout | `src/components/StaffLayout.jsx` |
| Student portal layout | `src/components/StudentLayout.jsx` |
| Coach assess page | `src/pages/staff/StaffAssess.jsx` |
| Coach attendance (multi-batch) | `src/pages/staff/StaffAttendance.jsx` |
| Coach dashboard | `src/pages/staff/StaffDashboard.jsx` |
| Student stats page | `src/pages/student/StudentStats.jsx` |

## Supabase
- Project ID: `vdvpwbhkdlbskewfgref`
- Storage bucket: `staff-photos` (public — photos, licences, academy logos)
- Staff auth: custom (anon role, no JWT) — every table staff writes to needs explicit anon policy
- `students.id` = BIGINT (not UUID) — all FK/joins must use BIGINT
- New tables use open RLS (`FOR ALL TO anon, authenticated USING (true)`)
