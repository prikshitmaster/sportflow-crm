# SportFlow CRM — Handoff Document
**Date:** 2026-05-15  **Branch:** main

---

## What Was Built (This Session)

### Performance System v1
Full player assessment + stats pipeline across all three portals.

**SQL** — `supabase/schema_performance.sql`
- `skill_assessments` table (student_id BIGINT, scores JSONB, assessed_month TEXT)
- `student_badges` table (reserved for future badge logic)
- Open RLS policies for anon + authenticated

**Shared lib** — `src/lib/performance.js`
- `FOOTBALL_CATEGORIES` — 4 groups × 28 skills (Technical, Tactical, Athleticism, Personality)
- `SPORT_CATEGORIES` map — Football wired, Tennis/Squash/Table Tennis reserved (null)
- `SKILL_SHORTS` — unique short labels for radar chart axes (avoids duplicate label bug)
- Helpers: `getCategoryAvg`, `getOverallScore`, `getTier`, `buildMonthOpts`, `monthLabel`
- Tier scale: Bronze 0–39 · Silver 40–59 · Gold 60–79 · Elite 80–100

**Coach: `/staff/assess`** — `src/pages/staff/StaffAssess.jsx`
- Tab 1 "Assess Players": month + batch picker → student list (assessed ✓ / pending ○) → bottom-sheet form
- Assessment form: 4 collapsible category sections, sliders 0–100 per skill, category avg shown live
- Re-submit prompt: "Update existing" or "Overwrite from scratch"
- Tab 2 "View Stats": search any player → lazy-load their latest assessment → category bars inline
- Fixed: select value is string, batch IDs are numbers → use `String(b.id) === batchId` + loose `==` for student filter

**Coach Dashboard** — `src/pages/staff/StaffDashboard.jsx`
- New "Player Stats" section: search bar + top 5 performers from coach's batches (fetched on mount)
- Tapping any player navigates to `/staff/assess`

**Student: `/student/stats`** — `src/pages/student/StudentStats.jsx`
- Premium design: indigo→purple gradient hero, white score ring with glow
- Radar chart: default = 4-category axes; click category tab → switches to per-skill axes in category colour
- Category pill tabs below radar (active tab fills with category colour + shadow)
- Skills panel: gradient progress bars, delta chips, coach note
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

## Known Issues / Still To Fix

- `staff_id` stored in assessments as BIGINT — verify `user.id` for staff is bigint (not UUID)
- `student_badges` table created but badge award logic not yet built
- Assessment SQL ran but if `students.id` type ever changes, re-check FK types

---

## Next Goals

### 3. Performance Dashboard Sections (DISCUSSED, NOT BUILT)

#### Owner Dashboard (`/dashboard` desktop)
Add a **Performance** widget:
- Leaderboard: all students ranked by overall score, filterable by batch
- Batch comparison: batch avg scores side by side
- **Top by category**: "Best Technical → Name 82 · Best Tactical → Name 76" (category cards)
- **Team Builder**: pick top N students overall or by category

#### Coach Dashboard (`/staff/home` mobile)
Enhance existing Player Stats section:
- Show full batch ranking (sorted by score)
- Top player per category within their batch
- One-tap to assess

#### Staff (non-coach office staff)
Skip performance section — they don't assess players.

#### Team Making Format (agreed: Option B — Category Cards)
4 cards: Best Technical / Best Tactical / Best Fitness / Best Mental
Each card: player name, score, tap to see full list sorted by that category

---

### 4. Full System Testing & Polish Pass
Go through every feature end-to-end:

| Area | What to test |
|---|---|
| Staff activation | Join code → set password → login → permissions work |
| Staff profile | Photo upload, licence upload, edit name/phone/age saves |
| Attendance (staff portal) | Mark session, coach sees own record |
| Leave requests | Submit → owner approves/rejects → staff sees update |
| Student add | Batch auto-fill, fee plan auto-fill, DOB fast entry |
| Payments | Add payment, auto-amount from fee plan, overdue detection |
| Suspension | Trigger after X days, reactivate, ageing report updates |
| Reports | Ageing buckets, trend charts, CSV export |
| Financial tab | AR view, outstanding KPIs, filters |
| Performance tab | Assessments show, leaderboard correct, batch heatmap |
| Multi-sport | Switching sport scopes data correctly |
| QR scan-in | Staff QR clock-in records to `staff_attendance` |

---

## Key Files Quick Reference

| What | File |
|---|---|
| All auth + state | `src/context/AppContext.jsx` |
| DB functions | `src/lib/db.js` |
| Performance helpers | `src/lib/performance.js` |
| Permissions | `src/lib/permissions.js` |
| Routes + guards | `src/App.jsx` |
| Staff portal layout | `src/components/StaffLayout.jsx` |
| Student portal layout | `src/components/StudentLayout.jsx` |
| Coach assess page | `src/pages/staff/StaffAssess.jsx` |
| Student stats page | `src/pages/student/StudentStats.jsx` |
| Staff dashboard | `src/pages/staff/StaffDashboard.jsx` |
| Owner reports | `src/pages/Reports.jsx` |
| Staff profile edit | `src/pages/staff/StaffProfile.jsx` |
| Full staff SQL | `supabase/schema_staff_complete.sql` |
| Performance SQL | `supabase/schema_performance.sql` |

## Supabase
- Project ID: `vdvpwbhkdlbskewfgref`
- Storage bucket: `staff-photos` (public — photos, licences, academy logos)
- Staff auth: custom (anon role, no JWT) — every table staff writes to needs explicit anon policy
- `students.id` = BIGINT (not UUID) — all FK/joins must use BIGINT
