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

### 1. World-Class Performance & Coaching System
A coach/player performance rating and comparison engine. Planned scope:

#### Coach Performance Module
- **Session rating** — after each attended batch session, system logs a coach performance score (1–5 stars, optional notes)
- **Coach leaderboard** — ranked list by avg rating, sessions coached, attendance rate
- **Trend graph** — rating over time per coach (Recharts line chart)
- **Badge system** — auto-awarded badges on milestones:
  - `Top Rated` — avg ≥ 4.5 over last 30 days
  - `Consistent` — 0 missed sessions in 30 days
  - `Veteran` — 100+ sessions logged
  - `Rising Star` — rating improved 1+ point in 30 days
- **Head-to-head compare** — select 2 coaches, side-by-side stats panel

#### Student Performance Module  
- **Skill assessment** per student per sport (e.g. Speed, Technique, Fitness, Attitude — 1–10 scale)
- **Position/tier badge** — auto-calculated from avg skill score:
  - Bronze (0–4) / Silver (4–6) / Gold (6–8) / Elite (8–10)
- **Progress timeline** — assessments plotted over time
- **Batch ranking** — students ranked within their batch by skill score
- **Parent-facing view** — student portal shows their own badge + progress (no other student data)

#### Database (new tables needed)
```sql
coach_ratings      (id, staff_id, batch_id, session_date, rating 1-5, notes, rated_by uuid)
coach_badges       (id, staff_id, badge_type, awarded_at)
student_assessments(id, student_id, batch_id, assessed_by, assessed_at, scores JSONB, notes)
student_badges     (id, student_id, badge_type, tier, awarded_at)
```

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
