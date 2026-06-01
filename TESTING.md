# SportFlow CRM — Testing Checklist

> **How to use:** Check off each box as you test. Re-run after every major change or migration.
> - 🔴 `[CRITICAL]` — can silently fail or corrupt data
> - 🟠 `[HIGH]` — likely to hit in normal use
> - 🟡 `[MED]` — edge case, less frequent
> - ⚪ `[LOW]` — rare scenario

---

## ⚡ START HERE — Known Potential Bugs (Check These First)

| # | Where | Bug | Severity |
|---|-------|-----|----------|
| 1 | Payments | `window.open()` for receipt → **null crash if popup blocker is ON** | 🔴 CRITICAL |
| 2 | Payments | Pending payment `p.month` is "May 2026" format but `monthFilter` is "2026-05" → **month filter may hide pending payments** | 🟠 HIGH |
| 3 | Attendance | No way to cycle back to **blank/empty** via click — once marked, must go through all 4 statuses | 🟠 HIGH |
| 4 | Auto-suspend | Default threshold is **3 days** (`sf_suspend_days` in localStorage). Verify which day it fires on your live data | 🟠 HIGH |
| 5 | WhatsApp | "Send WhatsApp Reminder" in Absent Today panel is a **stub button** — clicking does nothing | 🟡 MED |
| 6 | Receipt print | `setTimeout 400ms` before `w.print()` — may be too short on slow connections | 🟡 MED |
| 7 | Student portal | Groq API down/rate-limited → unhandled error may surface in UI | 🟡 MED |
| 8 | Batch delete | Students with deleted batch retain old `batchId` FK → disappear from batch view silently | 🟡 MED |
| 9 | Export Excel | Date range >12 months → many sequential DB awaits with no timeout | ⚪ LOW |
| 10 | Two-tab edit | Two coaches saving same student+day simultaneously → last save silently wins | ⚪ LOW |
| 11 | Routing | Unknown URL (e.g. `/student`) → silently redirects to `/dashboard` instead of 404 — **✅ CONFIRMED & FIXED** | ⚪ LOW |

---

## 1. Owner Auth ✅ (1 pending)

- [x] Log in with Supabase email/password → lands on `/sport-select`
- [x] Refresh page while logged in → stays logged in (JWT persisted)
- [x] Log out → `selectedSport` cleared → redirected to login
- [x] Navigate directly to `/students` without selecting sport → redirected to `/sport-select`
  - ℹ️ **Note:** If sport was set in a previous session, localStorage still has it → route guard lets you through (this is correct behavior — sport only clears on logout)
- [x] Type a non-existent URL like `/student` (typo) → **FIXED** — now shows 404 page with "Go to Home"
- [ ] 🔴 JWT expiry: leave tab open overnight → next morning click anything → redirects to login (not silent fail)
- [x] Two tabs: log out in tab 1 → tab 2 still shows data (ok) but any write fails gracefully

---
okay check everything in permision based if there is only view make sure view nothing else high prority if manage then manage fix ui and backend both    level take time 100% fix   

## 2. Staff Auth

- [ ] Activate staff at `/staff-activate` with correct staff code + join code
- [ ] Wrong join code → shows error, no session created
- [ ] Login with email + password → `sf_staff` stored in localStorage
- [ ] Refresh → session restored, stays logged in
- [ ] 🔴 Expired/deleted token: manually corrupt `sf_staff` in localStorage → app redirects, does not crash or loop
- [ ] Staff with no branch assigned sees ALL branch students
- [ ] 🔴 Staff with `branch_id` set sees ONLY their branch students — verify other branch student is blocked at RPC level
- [ ] Staff without `students.manage` → Add Student button hidden/disabled
- [ ] Staff without `payments.manage` → Record Payment hidden/disabled
- [ ] Staff logout → `sf_staff` cleared → redirect to staff login

---

## 3. Student Auth

- [ ] Student activates at `/student-activate` with correct student code + join code
- [ ] Wrong code → shows error
- [ ] Student login → `sf_student` stored in localStorage
- [ ] 🔴 Student with expired session → graceful redirect, not blank screen or crash
- [ ] Student portal pages load: Dashboard, Attendance, Payments, Announcements
- [ ] Student sees ONLY their own data — cannot access other students' records

---

## 4. Sport + Branch Scoping

- [ ] Select "All Sports" → all students/batches/payments shown
- [ ] Select specific sport (e.g. Football) → only Football students in Students, Attendance, Payments, Batches
- [ ] Switch sport mid-session → all pages filter immediately
- [ ] 🔴 After sport switch, Attendance page branch filter resets to "All" — stale batch not selected
- [ ] In Attendance "All Sports" mode: Branch pills appear, filter by sport branch correctly
- [ ] `selectedSport` cleared on logout → next login forces sport re-selection
- [ ] Branch manager login: sees only their branch data in sidebar + all pages

---

## 5. Students Page

- [ ] Add student — minimum fields only (Name, Phone, Fee) → saves
- [ ] Add student with all fields — DOB entered as DDMMYYYY → stored as YYYY-MM-DD correctly
- [ ] 🔴 Add student with batch + paidTill + fees > 0 → auto-creates a "Paid" payment → verify payment appears in Payments
- [ ] Edit student name/phone/fee → changes reflected immediately
- [ ] 🟠 Edit student's batch → batchId updates, old batch count decreases, new batch count increases
- [ ] Suspend student → status = Suspended, batch preserved, student grayed out
- [ ] Reactivate suspended student → status = Active, `suspendedSince` cleared
- [ ] Delete student → confirm dialog → removed → payments/attendance data still in DB
- [ ] Student photo upload → URL saved, photo shows on profile
- [ ] Search by name → results update instantly
- [ ] Filter by status (Active / Suspended / All) → counts correct
- [ ] Filter by sport + batch combination
- [ ] Student with `paidTill = null` → shows "No Payment" badge
- [ ] Pagination (if >50 students) → navigate pages correctly

---

## 6. Auto-Suspend

- [ ] 🔴 On day 3+ of month (default): Active students where `paidTill < first of month` → auto-suspended on app load
- [ ] Auto-suspend does NOT run again within 1 hour (throttle via `sf_last_auto_suspend_at` in localStorage)
- [ ] Suspended student pays → reactivated → `suspendedSince` cleared
- [ ] `paidTill = null` students → never auto-suspended
- [ ] On day 1–2 of month → auto-suspend does NOT run

---

## 7. Attendance Page

- [ ] Load page → current month shown, spinner → data appears
- [ ] 🔴 Select a batch → grid shows only that batch's students
- [ ] Click empty cell → cycles to Present
- [ ] Present → Absent → Late → Leave → back to Present
- [ ] 🟠 Verify there is no way to un-mark (go to blank) via cycle — confirm this is acceptable UX
- [ ] Future date cells → not clickable, greyed out
- [ ] Sunday columns → red-tinted
- [ ] "All Present" button → marks all displayed students as Present for today
- [ ] "All Absent" → marks all Absent for today
- [ ] 🔴 Save — only saves dirty cells (cells touched this session). Open two tabs, mark different students in each, save from both → no overwrite
- [ ] Save with 0 dirty cells → toast "No changes to save"
- [ ] Try to close/refresh tab with unsaved changes → browser "Leave site?" warning
- [ ] Alternate-day student: days they don't train show ✕ (off-day), cannot be clicked
- [ ] Navigate to previous month → data loads correctly
- [ ] Navigate beyond current month → blocked
- [ ] Month nav: January → back → goes to December of previous year
- [ ] Export Excel: select date range → downloads `.xlsx` with current batch students
- [ ] 🟠 Export: From > To date → error toast shown
- [ ] Mobile view: day picker strip → tap a day → student list updates for that day
- [ ] Mobile "All Present" for selected day → works
- [ ] Suspended students shown at bottom in red, read-only — cannot be marked
- [ ] 🟡 Multi-batch student: appears in both batch views
- [ ] Batch pill shows correct student count and today's attendance %
- [ ] Today's Summary panel updates live as you mark
- [ ] "Absent Today" panel: absent students listed
- [ ] 🟠 "Send WhatsApp Reminder" in Absent Today → verify it doesn't crash (stub button)
- [ ] Monthly Overview pie chart renders correctly

---

## 8. Payments Page

- [ ] Summary cards show Collected / Pending / Overdue amounts correctly
- [ ] Month filter → collected/pending filtered, overdue always all-time
- [ ] Clear month filter → all records shown
- [ ] Search by student name → filters instantly
- [ ] Search by invoice ID (partial)
- [ ] Filter by status: Paid / Pending / Overdue
- [ ] Filter by Sport + Batch dropdowns
- [ ] 🔴 Virtual "Overdue" rows (students with expired paidTill, no existing overdue record): appear at top in red
- [ ] Virtual row "Record" → opens Record Payment modal pre-filled with that student
- [ ] Virtual row "Remind" → opens WhatsApp with pre-filled message using parent/student phone
- [ ] 🟠 Pending payment with month filter active — verify pending payments WITHOUT a date still appear correctly
- [ ] Mark Paid → payment status → Paid, student `paidTill` updated
- [ ] 🟠 Double-click Mark Paid quickly → fires only once (in-flight lock)
- [ ] 🔴 Print Receipt with popup blocker ON → does NOT crash (test in Chrome with "Block popups" enabled)
- [ ] Print Receipt (popup allowed) → receipt HTML renders with academy name, logo, student info, amount
- [ ] Delete payment → confirm modal → optional reason → deleted → student `paidTill` rolls back
- [ ] Revenue chart (last 8 months) → bars match Paid payment dates
- [ ] Month with 0 revenue → 0-height bar, no crash
- [ ] Edit payment date: hover row → pencil icon → inline input → blur → saves
- [ ] Payment detail modal: click any Paid row → modal opens with breakdown
- [ ] Bulk WhatsApp "Remind (N)" button → opens WhatsApp bulk modal

---

## 9. Record Payment Modal

- [ ] Open → student search field is focused
- [ ] Type name → dropdown shows matches (max 10)
- [ ] Select suspended student → amber "payment will reactivate this student" warning
- [ ] Student already paid this month → blue "Advance payment starting..." info bar
- [ ] 🔴 Duplicate guard: student's paidTill covers coverage start → red banner + CONFIRM input → Save disabled until "CONFIRM" typed
- [ ] 🟠 Amount >30% off expected → sanity mismatch → also requires CONFIRM
- [ ] Plan mismatch warning: student is quarterly but you select monthly → amber warning
- [ ] Amount mismatch: enter monthly fee × 3 → "Did you mean Quarterly?" + Switch button → switch works
- [ ] Fee plan info bar: shows M/Q/Y rates for batch + "Use this rate" button
- [ ] "Use this rate" → sets baseAmount correctly
- [ ] Custom plan: select Custom → enter 5 months → coverage shows correct 5-month range
- [ ] Discount: enter 10% → discount calculated correctly in breakdown
- [ ] Late fee: "+ Add Late Fee" → enter amount → total updates → remove X clears it
- [ ] Override total directly via editable Total field → `amountOverride` applied
- [ ] Coverage label correct: "May 2026" (monthly), "May–Jul 2026" (quarterly), "Jan–Dec 2026" (yearly)
- [ ] IST date safety: coverage dates don't shift by 1 day due to UTC/IST difference
- [ ] Save → payment created → appears in list → student paidTill updated
- [ ] Save for suspended student → student becomes Active after payment
- [ ] Recent payments timeline (last 3) shown to spot duplicates

---

## 10. Batches Page

- [ ] Create batch: name, sport, days, time, capacity → saves
- [ ] Edit batch → changes appear in Attendance batch pills
- [ ] Delete batch → students with that batch retain their batch name string
- [ ] Batch capacity: enrolled count vs seats left shown correctly
- [ ] Assign student to batch → appears in batch view
- [ ] Unassign student from batch
- [ ] 🟠 Branch-scoped staff: cannot create/delete batches (owner only) — buttons hidden or blocked
- [ ] Fee plan: create M/Q/Y plan for batch → shows in Record Payment modal for that batch

---

## 11. Staff Page (Owner View)

- [ ] Add staff member → appears in list
- [ ] Invite staff via link → invite created → open in incognito → signup completes
- [ ] Role presets: Coach vs Admin → correct permissions pre-filled
- [ ] Edit staff permissions → toggle individual permissions → saves
- [ ] Delete staff → confirm → removed
- [ ] Staff with branch assignment → branch manager badge shown
- [ ] Staff profile: photo, age, licence URL saves correctly
- [ ] 🟠 Staff activate flow: `/staff-activate` → verify code → set password → lands on staff portal

---

## 12. Trials Page

- [ ] Add trial: name, phone, sport, source, date → saves
- [ ] Edit trial details
- [ ] Delete trial
- [ ] Convert trial to student → student created with `fromTrial = true`
- [ ] Trial sources: add custom source → appears in dropdown
- [ ] Delete trial source → removed from dropdown
- [ ] Branch-scoped staff: sees only their branch's trials
- [ ] 🟡 Staff without `trials.manage` → Add Trial button hidden

---

## 13. QR Attendance

- [ ] Owner generates Gate QR from AdminQR page → QR code renders
- [ ] Student scans QR → attendance marked for today
- [ ] 🔴 Student scans twice → second scan does NOT overwrite Present/Late (no-downgrade protection)
- [ ] Regenerate QR → old QR invalidated → new QR works
- [ ] Wrong/expired gate token → RPC error → student sees friendly error (not crash)
- [ ] QR attendance passes correct `batch_id` for student's current batch

---

## 14. Student Portal

- [ ] Student dashboard: name, sport, batch, attendance %, payment status shown
- [ ] Attendance history: own records only
- [ ] Payments: own payments only
- [ ] Announcements: academy-wide announcements visible
- [ ] 🟠 Student with no attendance records → dashboard shows 0%, no crash
- [ ] Scan page: QR scanner opens, can scan gate QR
- [ ] AI coaching tip (Groq): loads in StudentStats, cached in sessionStorage
- [ ] 🟡 Groq API down/invalid key → AiCoachTip fails silently, student page still usable

---

## 15. Staff Portal

- [ ] Staff login → StaffLayout with sidebar
- [ ] Staff Dashboard: today's attendance summary for their batches
- [ ] Staff Attendance: batch cards → mark attendance → save → saved to DB
- [ ] Staff Roster: student list for their batches
- [ ] Staff Notices: announcement list loads
- [ ] Staff Profile: edit own profile (age, licence, photo)
- [ ] 🟠 Staff with `attendance.manage` → can mark; without it → mark is blocked
- [ ] Branch-scoped staff: cannot mark attendance for other branch students
- [ ] Leave request: submit → appears in owner's view → owner approves/rejects → status updates
- [ ] Staff self-attendance (clock-in): logs daily attendance record

---

## 16. Events + Tournaments

- [ ] Create event: name, date, type → saves
- [ ] Edit event details
- [ ] Delete event
- [ ] Tournament: add match results (winner, score)
- [ ] Update match result
- [ ] 🟡 Delete event with matches → matches also deleted (no orphan rows)

---

## 17. Community / Announcements

- [ ] Owner creates announcement → appears in student portal
- [ ] Staff with `announcements.manage` creates announcement → appears
- [ ] Branch-scoped staff: announcement scoped to their branch
- [ ] 🟡 Announcement with empty title → blocked by validation

---

## 18. Reports Page

- [ ] Revenue report: totals match payment records
- [ ] Attendance report: per-student attendance % correct
- [ ] Export to Excel works
- [ ] Date range filter applies
- [ ] 🟡 New academy with no students → shows 0 values, no crash

---

## 19. Settings Page

- [ ] Academy name, logo, sport list edits save correctly
- [ ] 🟠 Academy logo upload → URL saved → appears on receipts and sidebar
- [ ] Suspend threshold: change `sf_suspend_days` in Settings → auto-suspend fires on new day
- [ ] Sports: delete sport with students → warning overlay shown before delete
- [ ] Branch (sport_branches): add / edit / delete
- [ ] Academy branches (multi-location): add / delete

---

## 20. Backups Page

- [ ] Backup page loads without error
- [ ] Manual backup → downloads file
- [ ] Backup contains only own academy's data (not other academies)
- [ ] 🟡 Large dataset (500+ students) → backup completes without timeout

---

## 21. Security Spot-Checks

> Use browser DevTools (Network tab) or Supabase REST client with the anon key.

- [ ] 🔴 `GET /rest/v1/students` with anon key + no token → returns only own academy students (NOT all academies)
- [ ] 🔴 `GET /rest/v1/payments` with anon key → same scoping, no cross-tenant data
- [ ] `GET /rest/v1/staff_auth` with anon key → returns empty (locked)
- [ ] Call any write RPC with fake/expired token → returns `42501 forbidden` error
- [ ] Cross-branch: staff token from Branch A calling update on Branch B student → blocked
- [ ] Run regression suite after any migration:
  ```
  node scripts/test-security-v3.mjs
  ```
  Must report **17/17 pass**

---

## 22. Device + Browser Matrix

- [ ] Chrome desktop (primary)
- [ ] 🟠 Safari iOS — QR scanner path + popup blocker (receipt print)
- [ ] Android Chrome (Capacitor build if applicable)
- [ ] Firefox desktop
- [ ] 🟠 Chrome with "Block popups" enabled — receipt print must not crash

---

## 23. Regression Checklist After Common Changes

Run these mini-checks after the changes listed:

| Change Made | What to Re-test |
|-------------|----------------|
| DB migration applied | Run `node scripts/test-security-v3.mjs` (17/17) |
| AppContext loadAll changed | Auto-suspend, sport scoping, payment status badges |
| Attendance RPC changed | Save dirty cells, two-tab edit, QR scan no-downgrade |
| Payment RPC changed | Record payment, mark paid, delete + paidTill rollback |
| Student RPC changed | Add student, suspend/reactivate, branch isolation |
| Staff auth changed | Login, token expiry, branch scoping |
| New page/route added | OwnerRoute sport guard, StaffLayout permission gates |

---

*Last updated: 2026-05-24 — re-verify after major releases*
