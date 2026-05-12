# SportFlow CRM — Routes & Pages

## Owner Portal (role = 'owner')

Layout: `src/components/Layout.jsx` wraps all owner pages with `Sidebar.jsx`.

| URL | Page File | Description |
|---|---|---|
| `/login` | `pages/Login.jsx` | 3-tab login (Owner / Staff / Student) |
| `/signup` | `pages/Signup.jsx` | Owner account creation |
| `/dashboard` | `pages/Dashboard.jsx` | KPIs, sport filter, leave requests, branch management |
| `/students` | `pages/Students.jsx` | Students list + Suspended tab; full CRUD + suspend/reactivate |
| `/attendance` | `pages/Attendance.jsx` | Monthly grid; mark P/A/Late/Leave per student per day |
| `/payments` | `pages/Payments.jsx` | Revenue chart; payment list with virtual overdue rows; record payment |
| `/trials` | `pages/Trials.jsx` | Trial leads pipeline; schedule/complete/convert |
| `/batches` | `pages/Batches.jsx` | Batch cards; create/edit batches; assign coaches |
| `/coaches` | `pages/Staff.jsx` | Staff HR; photo upload; invite to portal |
| `/reports` | `pages/Reports.jsx` | Analytics charts |
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
| `/staff/home` | `pages/staff/StaffDashboard.jsx` | Staff home: today's students, attendance summary |
| `/staff/me` | `pages/staff/StaffMe.jsx` | Staff profile; leave request submission |
| `/staff/roster` | `pages/staff/StaffRoster.jsx` | Full student roster (read-only or manage per permissions) |
| `/staff/notices` | `pages/staff/StaffNotices.jsx` | Read academy announcements |
| `/staff/attendance` | `pages/staff/StaffAttendance.jsx` | Mark attendance by batch; suspended students shown read-only |
| `/staff/scan-in` | `pages/staff/StaffScanIn.jsx` | Staff QR scan for clock-in |

### StaffAttendance — Suspended Student Display
```js
// Students shown read-only at bottom of batch roster with red "Suspended" badge
suspendedInBatch = students where status === 'Suspended'
  && (s.batchId === batch.id || s.batch === batch.name)
```
Batch card shows: `"N students · M suspended"`

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

---

## Public Routes

| URL | Notes |
|---|---|
| `/invite/:token` | Staff invite acceptance — no auth required |
| `*` | Catch-all → redirects to `/login` |

---

## Feature Flag Gating

Owner can disable modules in Settings. Feature flags are checked via `isFeatureOn(name)` from AppContext.

Features: `attendance`, `payments`, `trials`, `batches`, `staff`, `reports`, `community`, `events`, `gate_qr`

When a feature is disabled, its sidebar link is hidden and navigating to the page should return early or show a disabled state.
