# SportFlow CRM — Manual Test Plan

Use this checklist before every production push. Mark each box as `[x]` when verified.

---

## 0. Setup

- [ ] `npm run dev` starts without errors
- [ ] `.env` has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GROQ_KEY`
- [ ] Browser DevTools console clean on home page (no red errors)
- [ ] Test on desktop Chrome + mobile (real device or Chrome DPR emulation Pixel 7)

---

## 1. Owner flow

### Auth
- [ ] Sign up new owner → academy created → join code displayed
- [ ] Logout → login again with same email → redirects to dashboard
- [ ] Refresh page → session restored, no flash of login screen
- [ ] Login with wrong password → friendly error (not raw Supabase message)

### Students
- [ ] Add student → appears in list immediately
- [ ] Upload photo on detail panel → photo displays after refresh
- [ ] Edit batch → batch enrolled count updates correctly
- [ ] Suspend student → status badge changes, batch enrolled -1
- [ ] Reactivate student → status badge changes, batch enrolled +1
- [ ] Delete student → confirms with name, dues are surfaced
- [ ] Bulk import via CSV (if feature is on)
- [ ] Search by name/code/phone works

### Payments
- [ ] Record payment → invoice number is unique (no duplicates)
- [ ] Mark Paid button does NOT register twice on double-click
- [ ] Edit payment date → reflects in monthly grid
- [ ] Remove payment → status reverts on student
- [ ] Overdue filter shows only unpaid past-month students
- [ ] Export payments CSV downloads with correct rows

### Attendance
- [ ] Mark attendance via date grid → saves
- [ ] Cycle status Present → Absent → Late → blank (undo) → Present
- [ ] Multiple coaches mark same student same day → no duplicate row
- [ ] Date near midnight (IST) saves on the right day (timezone bug check)

### Batches
- [ ] Create batch → assign coach → save
- [ ] Capacity check — adding student to full batch shows warning
- [ ] Sport-scoped: switching sport filters batches

### Reports
- [ ] Loads without freezing UI
- [ ] Sport filter applies across all sections
- [ ] CSV export downloads
- [ ] Ageing/overdue numbers match Payments page

### Settings
- [ ] Toggle feature flag → reflected in nav within seconds
- [ ] Upload academy logo → shows in header

---

## 2. Coach / Staff flow

### Auth
- [ ] Owner invites staff → join code copyable
- [ ] Staff activates with code → sets password → logs in
- [ ] Wrong code → friendly error
- [ ] Staff session persists across refresh
- [ ] Logout works

### Permissions
- [ ] Office staff sees Office tabs (Home, Scan In, Notices, Me)
- [ ] Coach staff sees Coach tabs (Home, Attend, Assess, Notices, Me)
- [ ] Permission-gated route shows "Access Restricted" if not granted
- [ ] Permission added → reflects after re-login (or live if context refresh)

### Attendance
- [ ] Mark roster — full batch marked in <30 sec
- [ ] QR scan-in works (camera permission asked once)
- [ ] Already-scanned student today → friendly message, no duplicate
- [ ] Late mark cycles to blank for undo

### Assessment
- [ ] Pick batch → pick player → open assessment modal
- [ ] Position picker is collapsed by default; shows current value
- [ ] Tap to expand → grid of positions → tap to select → auto-collapse
- [ ] Save assessment → appears in View Stats
- [ ] AI tip generates within 3s (Groq key required)
- [ ] AI tip caches per assessment (no re-fetch on revisit)
- [ ] "Update existing" vs "Overwrite" prompt appears when assessment exists

### Leave
- [ ] Submit leave request → appears in admin queue
- [ ] Owner approves → status updates on coach side

---

## 3. Student flow

### Auth
- [ ] Student first-login: enters student_code + activates with password
- [ ] Session persists across refresh
- [ ] Optimistic restore — student lands on dashboard without spinner

### Dashboard
- [ ] Greeting matches time of day
- [ ] Photo upload via camera icon works
- [ ] "Scan Gate QR" tile navigates to scanner
- [ ] Today's status reflects actual attendance
- [ ] Month attendance count is accurate
- [ ] Fee overdue alert shows ONLY when fees unpaid (not when paid)
- [ ] Notices section shows announcements from same academy only
- [ ] Notices "All" link goes to /student/announcements

### Stats
- [ ] Radar chart renders without overflow on Pixel 7 screen
- [ ] Category pills filter to single-skill view
- [ ] Trend line shows after 2+ assessments
- [ ] AI Coach card appears (if VITE_GROQ_KEY set)
- [ ] AI card shows structured sections (Strength, Focus, Drills, Verdict)
- [ ] Refresh button regenerates tip
- [ ] Pitch view shows only positioned players (no "No Position Assigned" section)

### Attendance
- [ ] Monthly grid loads
- [ ] Navigate previous/next month
- [ ] Days color-coded with text labels (not color-only)

### Payments
- [ ] History shows all months
- [ ] Tap row → receipt visible (if implemented)
- [ ] Empty state when no payments yet

### Announcements (Notice tab)
- [ ] Tapping Notice tab navigates correctly (not redirect to login)
- [ ] Events visible per audience_type (all / students / batches)
- [ ] Empty state shows when no notices

### Scan
- [ ] Opens camera (permission ask)
- [ ] Scan valid gate QR → success → returns to dashboard
- [ ] Already marked today → friendly message
- [ ] Invalid QR → error toast

---

## 4. Mobile-specific

- [ ] Tap any button — no blue flash highlight
- [ ] Long-press on text/image — no "Copy / Search / Share" popup
- [ ] Long-press on link — no "Open in new tab" Android popup
- [ ] Tap input — keyboard appears, no zoom on iOS
- [ ] Page scrolls smoothly (no rubber-band overscroll on iOS)
- [ ] Bottom nav stays above iPhone home bar (safe area)
- [ ] Active tab has dot indicator + colored icon
- [ ] Page transition fades/slides in
- [ ] Scrollbars hidden on mobile (visible on desktop)
- [ ] "Add to Home Screen" works → opens standalone (no browser bar)

---

## 5. Cross-browser

- [ ] Chrome desktop
- [ ] Safari iOS (real device — iPhone)
- [ ] Chrome Android (real device — Samsung)
- [ ] Brave / Firefox (basic smoke)
- [ ] Slow 3G throttle (DevTools Network) → app still usable

---

## 6. Edge cases & known risk areas

- [ ] Owner has 0 students → dashboard doesn't crash
- [ ] Student has 0 assessments → Stats page shows empty state, not crash
- [ ] Coach has 0 batches → Home page renders, no DB N+1 on empty batches
- [ ] Network drops mid-save → user sees error, can retry
- [ ] Two coaches mark attendance for same student same minute → DB doesn't duplicate
- [ ] Negative batch.enrolled count never appears
- [ ] Refresh during AI tip load → no stuck loading state
- [ ] Decimal fees (₹1000.50) preserved exactly through save → fetch
- [ ] Suspended student tries to login → blocked with clear message
- [ ] Deleted student doesn't appear in roster/reports
- [ ] Sport switch on owner → all data filters correctly
- [ ] Date around midnight (23:50–00:10 IST) → attendance saves on right day
- [ ] CSV import with malformed row → reports specific row error
- [ ] Session token expires → silent re-auth or clean redirect to login

---

## 7. Production deploy smoke (5-min check after deploy)

- [ ] Production URL loads
- [ ] Login as owner / coach / student all work
- [ ] AI tips render (VITE_GROQ_KEY set in Vercel/Netlify env)
- [ ] Photo upload works in production
- [ ] PWA installable from Chrome menu
- [ ] No console errors on landing
