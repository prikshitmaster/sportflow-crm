# SportFlow CRM — Improvement Backlog

Audit date: 2026-05-15 · Source: 5 parallel research agents (bugs, performance, code quality, UX, architecture). Read-only audit, no code edits.

---

## 1. Critical bugs (fix first — can corrupt data or crash app)

| # | File:line | Issue | Effect |
|---|---|---|---|
| C1 | `src/context/AppContext.jsx:141` | Auto-suspend + manual suspend both decrement `batch.enrolled` | Batch capacity goes negative |
| C2 | `src/context/AppContext.jsx:688,736` | `students.find(s => s.id === Number(p.studentId))` — Supabase returns string IDs | Lookup silently misses, UI desync |
| C3 | `src/context/AppContext.jsx:115` | No await barrier in attendance save → fetch loop | Double tap = duplicate attendance marks |
| C4 | `src/lib/auth.js:48` | Session expiry compares string-to-Date without timezone | Sessions may expire wrong side of midnight in IST |
| H5 | `src/pages/Payments.jsx:282` | "Mark Paid" button not disabled during async | Double-record payments / DB constraint violation |
| H4 | `src/lib/db.js:1237,1269` | `fetchProfile()` & `findAcademyByCode()` use `.single()` | Throws (crash) on 0 rows or duplicates |
| H1 | `src/context/AppContext.jsx:693` | `activateStudentWithBatch()` no try/catch | Partial DB update leaves UI/DB out of sync |
| H6 | `src/lib/db.js:672` | `new Date(row.date).getDate()` w/o timezone | Date shifts by 1 day in IST near midnight |

---

## 2. Performance wins (ranked by impact)

### Critical
1. **`fetchNextInvoiceNum()` loads entire payments table** (`db.js:732`) — every payment fires `select('id')` on full table. Use `count('exact')` + `order(id, desc).limit(1)` instead. Saves ~500ms per payment at 1k rows.

2. **`select('*')` on every fetch** (`db.js` lines 5, 118, 275, 328, 375, 975, 1011, 1115) — narrow to needed columns. At 500 students × 10 unused columns = ~5KB per fetch wasted. Cuts data transfer ~40%.

### High
3. **`Payments.jsx:57-80` overdueRows is O(n²) un-memoized** — wrap in `useMemo([students, payments])`. Saves ~200ms per filter on 500+ students.

4. **`updateBatchEnrolled` fires N+1 inside suspend loop** (`AppContext.jsx:133`) — batch into a single RPC.

5. **`xlsx` (~700KB) imported at module level** (`exportImport.js:1`) — move to `await import('xlsx')` inside export handler. Strips 700KB from initial bundle.

### Medium
6. Verify `Reports.jsx` (89KB) is actually code-split, not inline.
7. Student photo lists missing `loading="lazy"` in some places.
8. `fetchStaff()` wide-join — split into list + detail queries.
9. Re-fetches on every tab switch instead of using cached context (5-min TTL would suffice).

---

## 3. Code quality debt

### Console statements in production (17 found)
`supabase.js:7`, `AppContext.jsx:148,156,246,466,1110`, `Reports.jsx:1182`, `Attendance.jsx`, `Events.jsx`, `Staff.jsx`, `StaffAssess.jsx:63`, `StaffDashboard.jsx`, `StudentDashboard.jsx:39`, `StudentAttendance.jsx:37`, `StudentPayments.jsx:27`, `StudentStats.jsx:28`, `StudentAnnouncements.jsx`, `StaffNotices.jsx`.

### Magic strings begging to be enums
- Status: `'Active'`, `'Suspended'`, `'Pending'`, `'Paid'`, `'Deleted'` — scattered across `db.js` (lines 73, 75, 151, 189, 200, 216, 218) and many pages.
- Roles: `Staff.jsx:9` defines `ROLES` array locally; no central enum in `lib/permissions.js`.
- Case mismatches: `'Daily'` vs `'daily'` (`db.js:35` vs `db.js:1037`).

### Field naming inconsistencies (snake_case vs camelCase)
DB returns snake_case (`academy_id`, `student_id`, `batch_id`, `paid_till`). Fetch functions map to camelCase but several components consume raw snake_case directly. Example breakage: `StudentAnnouncements.jsx` had to use `studentUser?.academy_id` not `academyId`.

### Duplicate logic
- `.split('T')[0]` used 8+ times in `db.js` (lines 71, 150, 252, 809, 822, 888, 914, 1000) → should be a `toDateStr()` helper.
- `buildMonthOpts()` redefined as `buildMonthOptions()` in `Reports.jsx:25` with different month count.
- `suspendStudent()` and `reactivateStudent()` (db.js:70, 215) duplicate fallback try-catch.

### Files too large (split candidates)
| File | Size | Responsibilities |
|---|---|---|
| `Reports.jsx` | 89KB / 1,729 lines | 6+ sections: dashboard, finance, attendance, players, performance, audit |
| `Staff.jsx` | 86KB / 1,830 lines | Roster, leave, access, roles all in one |
| `Students.jsx` | 68KB / 1,428 lines | CRUD + DOB + position + photo + batch + suspension |
| `db.js` | 58KB / 1,672 lines | 16+ logical sections |
| `AppContext.jsx` | 57KB | All state + all auth + all CRUD |

### Unused / suspicious deps
- `jsqr` may be redundant — `html5-qrcode` is primary scanner.
- Verify `xlsx` actual usage (CSV exports might be enough).

---

## 4. UX improvements (prioritized)

### Critical UX (accessibility + trust)
1. **Silent error swallowing** — multiple pages `.catch(console.error)` with no user feedback. User has no idea load failed. Add toast/inline error.
   - `StudentPayments:27`, `StudentAttendance:37`, `StudentDashboard:39`, `StudentStats:28`, `StaffAssess:63`.
2. **Color-only status badges** — paid/overdue/pending rely on color alone. Add text or `sr-only` labels for colorblind users.
3. **Icon-only buttons missing `aria-label`** — camera upload, chevrons, copy, reset.
4. **Mobile tap targets <44px** — `.btn-primary` uses `py-2.5` (≈32px). Need `py-3+`. Close `X` icons are 16px.

### Friction fixes
5. Full-screen spinners on `Dashboard.jsx:95` and `StudentStats.jsx:31` — replace with skeleton.
6. `StudentDashboard.jsx` has no empty state when no announcements or payments.
7. Multi-step flows (Signup, Activate, Add Student wizards) have no step indicator.
8. Form submit buttons don't disable during async (double-submit risk).
9. Delete modals say generic "Delete" — should say what's being deleted (`Delete student Arjun + ₹3,500 dues`).

### Missing features users notice
10. No search/filter on `StudentPayments`.
11. No undo on destructive actions (delete student, remove payment, leave request).
12. No bulk actions — coaches mark 50 students one at a time.
13. No first-login onboarding (owner sees blank dashboard with no "next step" guidance).
14. Field-level form validation everywhere is alert-based instead of inline.

---

## 5. New feature opportunities ("what we can do better")

### AI extensions (key already deployed)
- **AI Chat Coach** — student asks "why is my dribbling weak?", AI answers using their score data. Differentiator nobody else has.
- **Monthly AI Progress Letter** — auto-WhatsApp/email parents a summary on the 1st.
- **AI bulk insights for owners** — "5 students at risk of churn this month based on attendance + fees" on dashboard.

### Owner efficiency
- Bulk attendance via CSV upload.
- Auto fee reminder WhatsApp/SMS 3 days before due date.
- One-tap "send receipt" from payment row.
- Saved filter views in Reports.

### Coach efficiency
- Voice-note → AI transcribes to assessment notes.
- "Last week summary" tile on coach home (attendance %, fee collection, new assessments).
- Quick mark-attendance from notification (web push).

### Student engagement
- Streak/badge system for attendance.
- Leaderboard within batch (opt-in, anonymized).
- Compare-with-rival tap on pitch view (mostly built).
- Goal-setting: "Improve passing from 6→7 by next month" with weekly check-in.

### Operational
- PWA push notifications (manifest exists, service worker needs install logic).
- Offline mode for attendance marking when ground has no signal.
- Multi-language (Hindi at minimum) for parent-facing student portal.
- Export attendance/fees as Excel from student profile (single-click for IT).

---

## 6. Quick wins (low effort, high payoff)

| Effort | Win | Where |
|---|---|---|
| 15 min | Memoize `overdueRows` | `Payments.jsx:57` |
| 30 min | Lazy-load xlsx | `exportImport.js:1` |
| 1 hour | Fix invoice number fetch | `db.js:732` |
| 1 hour | Add `disabled={loading}` to all submit buttons | global pattern |
| 1 hour | Strip console.logs via build step (vite plugin) | `vite.config.js` |
| 2 hours | Narrow `select('*')` to needed columns | `db.js` core fetches |
| 2 hours | Extract status enums into `src/lib/constants.js` | scattered |

---

## 7. Tests we should write (currently zero)

There are no automated tests. The most valuable to add first:
1. **Auth flow integration tests** — Supabase mock, verify owner/staff/student session restore.
2. **DB function unit tests** — `src/lib/db.js` is 58KB of pure functions, ideal for unit tests.
3. **Performance.js unit tests** — `getCategoryAvg`, `getOverallScore`, `getTier` — pure math, trivial to cover.
4. **Auto-suspend cron logic** — race-condition prone, deserves a test.
5. **Payment amount precision** — currency math is dangerous untested.

See `TESTING.md` for the manual test plan.
