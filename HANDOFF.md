# SportFlow CRM — Handoff Document
**Date:** 2026-05-13  **Branch:** main  **Last commit:** fix: remove Default Fee Plan section

---

## What Was Built (This Session)

### Staff Portal v3
- **Permission-based work tiles** — all staff roles see tiles filtered by their `permissions[]` array (not just office staff)
- **Admin pages under `/staff/*`** — Students, Payments, Trials, Batches, Reports, Community, Events, Coaches, Settings all route inside `StaffLayout` with `PermRequired` gate
- **`/staff/profile` page** — staff can edit photo, name, phone, age, football/sport licence (PDF/image)
- **Profile photo upload** → Supabase Storage `staff-photos` bucket → `photo_url` on `staff` table
- **Licence upload** → same bucket under `licences/` path → `staff_profiles.licence_url`
- **`staff_profiles` table** — separate table for age + licence (PostgREST schema cache workaround; never ALTER TABLE on `staff`)
- **Complete idempotent SQL** — `supabase/schema_staff_complete.sql` sets up all tables + RLS in one paste

### Batches
- Removed "Default Fee Plan" section (Default Fee + Training Type) from Create/Edit Batch modal — redundant with Settings → Fee Plans

---

## Known Open Issue

**"new row violates row-level security policy"** on profile save  
Flow: `uploadStaffPhoto` → `updateStaffProfile` → `upsertStaffProfileExtra`  
Run this in Supabase SQL Editor to diagnose which table is missing a policy:
```sql
SELECT tablename, rowsecurity FROM pg_tables 
WHERE tablename IN ('staff', 'staff_profiles');

SELECT policyname, tablename, cmd FROM pg_policies 
WHERE tablename IN ('staff', 'staff_profiles');

SELECT policyname FROM pg_policies 
WHERE tablename = 'objects' AND schemaname = 'storage';
```
If `staff_profiles` has no `anon INSERT` policy, run `schema_staff_complete.sql` again.

---

## Next Goals

### 1. World-Class Student Performance System

**Decisions locked:**
- Coach fills assessments — monthly cadence
- Visible in student portal (students see their own data only)
- Sports in scope: Football (primary), Tennis, Squash, Table Tennis
- Scale: 300–600 students

#### Sport Skill Sets (rate 1–10)

| Sport | Skills |
|---|---|
| Football | Dribbling · Passing · Shooting · Positioning · Fitness · Teamwork |
| Tennis | Forehand · Backhand · Serve · Footwork · Match Play |
| Squash | Shot Accuracy · Court Movement · Serve · Strategy · Fitness |
| Table Tennis | Forehand · Backhand · Serve & Return · Footwork · Match Play |

#### Tier Formula
```
avg of all skills:
1.0 – 3.9  →  Bronze
4.0 – 5.9  →  Silver
6.0 – 7.9  →  Gold
8.0 – 10   →  Elite
```

#### Badges (auto-awarded)
- **Most Improved** — biggest positive delta in a month
- **Top in Batch** — highest avg score in their batch
- **All-Rounder** — no single skill below 6
- **Elite** — avg ≥ 8
- **Consistent** — no skill drop over 3 consecutive months

#### 3 Screens to Build

**Screen 1 — Coach Assessment** (`/staff/assess`)
- Coach selects batch → student list with done/pending status
- Tap student → 5–6 sliders (1–10) + optional note
- Submit saves to `skill_assessments` for that month
- Green tick = assessed, grey = pending

**Screen 2 — Student Portal: My Progress**
- Tier badge (Bronze/Silver/Gold/Elite) displayed prominently
- Radar chart of current skill scores
- Delta vs last month per skill: *"Passing +2 ↑ · Shooting -1 ↓"*
- Badges earned listed

**Screen 3 — Owner: Performance Dashboard** (tab in Reports)
- Top students leaderboard by avg score
- Coach effectiveness: whose students improve fastest
- Alert list: students with 0 improvement over 2+ months
- Batch heatmap: colour-coded avg score per batch

#### Database (2 new tables)
```sql
skill_assessments (
  id, student_id, staff_id, batch_id, sport,
  assessed_month TEXT,   -- format: 'YYYY-MM'
  scores JSONB,          -- { "dribbling": 7, "passing": 8, ... }
  notes TEXT, created_at
)

student_badges (
  id, student_id, badge_type, awarded_at
)
```

#### Build Order
1. SQL — create tables + RLS
2. Coach assessment screen (data entry — nothing works without this)
3. Student portal progress view
4. Owner performance dashboard + badge auto-award logic

### 2. Full System Testing & Polish Pass
Go through every feature end-to-end and fix rough edges:

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
| Multi-sport | Switching sport scopes data correctly on all pages |
| QR scan-in | Staff QR clock-in records to `staff_attendance` |

---

## Key Files Quick Reference

| What | File |
|---|---|
| All auth + state | `src/context/AppContext.jsx` |
| DB functions | `src/lib/db.js` |
| Permissions | `src/lib/permissions.js` |
| Routes + guards | `src/App.jsx` |
| Staff portal layout | `src/components/StaffLayout.jsx` |
| Staff profile edit | `src/pages/staff/StaffProfile.jsx` |
| Staff dashboard + tiles | `src/pages/staff/StaffDashboard.jsx` |
| Full staff SQL | `supabase/schema_staff_complete.sql` |

## Supabase
- Project ID: `vdvpwbhkdlbskewfgref`  
- Storage bucket: `staff-photos` (public, needed for photo + licence uploads)  
- Staff auth: custom (anon role, no JWT) — every table staff writes to needs explicit anon policy
