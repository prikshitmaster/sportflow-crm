# SportFlow CRM — Routes & Pages

## Owner Portal (role = 'owner')

Layout: `src/components/Layout.jsx` wraps all owner pages with `Sidebar.jsx`.

| URL | Page File | Description |
|---|---|---|
| `/login` | `pages/Login.jsx` | 3-tab login (Owner / Staff / Student) |
| `/signup` | `pages/Signup.jsx` | Owner account creation |
| `/dashboard` | `pages/Dashboard.jsx` | KPIs, sport filter, leave requests, branch management |
| `/students` | `pages/Students.jsx` | Students list + Suspended tab; full CRUD + suspend/reactivate + multi-batch assign |
| `/attendance` | `pages/Attendance.jsx` | Monthly grid; mark P/A/Late/Leave per student per day |
| `/payments` | `pages/Payments.jsx` | Revenue chart; payment list with virtual overdue rows; record payment |
| `/trials` | `pages/Trials.jsx` | Trial leads pipeline; schedule/complete/convert |
| `/batches` | `pages/Batches.jsx` | Batch cards (mobile-friendly); create/edit; multi-batch assign panel |
| `/coaches` | `pages/Staff.jsx` | Staff HR; photo upload; invite to portal |
| `/reports` | `pages/Reports.jsx` | Analytics: Overview · Financial (AR) · Performance · Audit Log |
| `/community` | `pages/Community.jsx` | Post announcements |
| `/settings` | `pages/Settings.jsx` | Feature flag toggles; academy settings |
| `/gate-qr` | `pages/AdminQR.jsx` | Generate/display gate QR code for student scan-in |
| `/staff-qr` | `pages/StaffAttendanceQR.jsx` | QR for staff clock-in |
| `/events` | `pages/Events.jsx` | Events calendar; upcoming/past; status management |
| `/invite/:token` | `pages/Invite.jsx` | Staff invite acceptance (public, no auth required) |

---

## Staff Portal (role = 'staff')

Layout: `src/components/StaffLayout.jsx`.

| URL | Page File | Description |
|---|---|---|
| `/staff-login` | `pages/StaffLogin.jsx` | Staff login |
| `/staff/home` | `pages/staff/StaffDashboard.jsx` | Staff home: today's students, Player Stats section |
| `/staff/me` | `pages/staff/StaffMe.jsx` | Staff profile; leave request submission |
| `/staff/roster` | `pages/staff/StaffRoster.jsx` | Full student roster (read-only or manage per permissions) |
| `/staff/notices` | `pages/staff/StaffNotices.jsx` | Read academy announcements |
| `/staff/attendance` | `pages/staff/StaffAttendance.jsx` | Mark attendance by batch; multi-batch roster; suspended shown read-only |
| `/staff/scan-in` | `pages/staff/StaffScanIn.jsx` | Staff QR scan for clock-in |
| `/staff/assess` | `pages/staff/StaffAssess.jsx` | Player assessment + view stats (coach portal) |

### StaffAttendance — Multi-Batch + Suspended Display
```js
// Roster includes:
// 1. Students with primary batch_id matching the selected batch
// 2. Students enrolled via student_batches (multi-batch) — fetched via fetchBatchEnrolments()
// 3. Suspended students shown read-only with red "Suspended" badge at bottom
suspendedInBatch = students where status === 'Suspended'
  && (s.batchId === batch.id || s.batch === batch.name)
```
Batch card shows: `"N students · M suspended"`

### StaffAssess — Two tabs
1. **Assess Players**: month + batch picker → student list (assessed ✓ / pending ○) → bottom-sheet form with sliders (0–100) per skill category
2. **View Stats**: search any player → lazy-load their latest assessment → category bars inline

Bottom nav for coaches: **Home · Attend · Assess · Notices · Me**

---

## Student Portal (role = 'student')

Layout: `src/components/StudentLayout.jsx` + `BottomNav.jsx` (mobile).

| URL | Page File | Description |
|---|---|---|
| `/student-login` | `pages/StudentLogin.jsx` | Student login (student_code + password) |
| `/activate` | `pages/Activate.jsx` | First-time activation (student_code + join_code + set password) |
| `/student/dashboard` | `pages/student/StudentDashboard.jsx` | Student home: batch info, next payment, attendance summary |
| `/student/attendance` | `pages/student/StudentAttendance.jsx` | Own attendance calendar (monthly view) |
| `/student/payments` | `pages/student/StudentPayments.jsx` | Own payment history |
| `/student/notices` | `pages/student/StudentAnnouncements.jsx` | Academy announcements |
| `/student/scan` | `pages/student/StudentScan.jsx` | Scan gate QR code to mark own attendance |
| `/student/stats` | `pages/student/StudentStats.jsx` | Player performance stats, radar chart, tier badge |

### StudentStats Design
- Gradient hero (indigo→purple) with score ring + glow
- Radar chart: default 4-category axes; click tab → per-skill axes in category colour
- Category pill tabs below radar (active fills with category colour)
- Skills panel: gradient progress bars, delta chips vs last month, coach note
- History line chart (multi-month trend)
- Tier scale card with "You" badge (Bronze 0–39 · Silver 40–59 · Gold 60–79 · Elite 80–100)

Bottom nav for students: **Home · Scan · Attend · Stats · Fees · Notice**

---

## Public Routes

| URL | Notes |
|---|---|
| `/invite/:token` | Staff invite acceptance — no auth required |
| `*` | Catch-all → redirects to `/login` |

---

## Reports Page Tabs

`/reports` has 4 tabs:

| Tab | Contents |
|---|---|
| Overview | KPI cards, trend charts, collection rates |
| Financial | ERP Accounts Receivable — ageing buckets, outstanding, CSV export |
| Performance | Assessment KPIs, leaderboard, batch heatmap, not-assessed list |
| Audit Log | Chronological action timeline; filter by entity type; search by actor/name |

---

## Batches Page — Mobile-Friendly Redesign

Batch cards redesigned for readability at any screen size:
- **Color accent bar** at top of card (`h-1` stripe, one of 5 hex colors)
- **Plain bold batch name** (no `rounded-full` oval that breaks with long names)
- Compact schedule row: time range + day pills
- Capacity progress bar (color-matched to accent)
- Coach avatar uses the same accent hex color
- Grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
- Entire card is clickable (no separate "open" button)

---

## Feature Flag Gating

Owner can disable modules in Settings. Feature flags are checked via `isFeatureOn(name)` from AppContext.

Features: `attendance`, `payments`, `trials`, `batches`, `staff`, `reports`, `community`, `events`, `gate_qr`

When a feature is disabled, its sidebar link is hidden and navigating to the page should return early or show a disabled state.
