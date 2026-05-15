# Corner Cases & Non-Obvious Behaviors

A running log of behaviors that look like bugs but are intentional, and subtle rules that future changes must not break.

---

## Batch Enrollment — "Primary" vs "Remove"

**Where:** `Batches.jsx` → `BatchDetailPanel` → Enrolled Students list

**Behavior:**
- Students show **"Remove"** → assigned via `student_batches` junction table (multi-batch). Can be unassigned without affecting anything else.
- Students show **"Primary"** → this batch is set directly on `students.batch_id`. Cannot be removed from here.

**Why:**
The system has two ways a student can belong to a batch:
1. `students.batch_id` — their primary/default batch (set when creating or editing a student profile)
2. `student_batches` table — additional batch assignments added by staff

`canUnassign = mbStudentIds.has(s.id)` — only true for row 2.

**To move a "Primary" student out of a batch:**
Edit their student profile → change the Batch field. There is no "remove" shortcut in the batch panel for primary students.

**File:** `src/pages/Batches.jsx` line ~597–621

---

## Multi-Batch Filter on Students Page

**Where:** `Students.jsx` → Batch dropdown filter

**Behavior:** Filtering by a batch shows students whose `batch_id` matches AND students in `student_batches` for that batch.

**Why it was broken before:** The old filter only checked `students.batch` (text name), missing students assigned via `student_batches`. Fix: dropdown value uses `b.id` (number), filter checks both `String(s.batchId) === batchFilter` and `mbStudentIds.has(s.id)`.

**Files:** `src/pages/Students.jsx` — `mbStudentIds` state, `matchBatch` function

---

## Student Auth — Custom Session (Not Supabase Auth)

**Where:** Student portal (`/student/*`)

**Behavior:** Students do NOT use Supabase's built-in auth. They log in with a student code + password, which creates a row in `student_sessions`. The Supabase client runs as the `anon` role for all student portal calls.

**Implications:**
- Storage RLS policies must allow `anon` role (not just `authenticated`) for any bucket students upload to
- `students` table updates from the student portal will be blocked if RLS requires `authenticated`
- `studentUser` is a raw Supabase row (snake_case: `photo_url`, `batch_id`, `student_code`) — no camelCase mapping

**File:** `src/lib/db.js` → `validateStudentSession`, `loginStudentAccount`

---

## Student Photo URL — Persistence vs Session

**Where:** `StudentDashboard.jsx` → photo upload

**Behavior:** After upload, the photo shows immediately in the current session (React state is updated). However, if `students` table RLS blocks the `UPDATE` for anon users, the `photo_url` column is not actually saved to DB — the photo disappears on next login.

**Fix:** Run `supabase/schema_student_photos_bucket.sql` which sets the `student-photos` bucket to allow anon uploads, and ensure `students` table has an update policy for the photo_url column.

---

## Pitch View — Batch ID Fallback

**Where:** `StudentStats.jsx` → `PitchViewCard`

**Behavior:** If `studentUser.batch_id` is null (older students added before the batch_id FK was introduced), the pitch view falls back to querying `student_batches` for any batch the student is in.

**File:** `src/pages/student/StudentStats.jsx` → `PitchViewCard` useEffect, `db.fetchStudentAnyBatchId`

---

## Position Colors — Preset vs Custom

**Where:** `StaffAssess.jsx`, `Reports.jsx` leaderboard, `StudentStats.jsx` hero

**Behavior:** `POSITION_COLORS` only maps the 11 preset 4-3-3 IDs (GK, RB, RCB, LCB, LB, CDM, LCAM, RCAM, LW, ST, RW). If a coach types a custom position name (e.g. "False 9", "Libero"), `FOOTBALL_POSITIONS.find(p => p.id === position)` returns undefined → falls back to grey badge. No error.

**File:** `src/lib/performance.js` → `FOOTBALL_POSITIONS`, `POSITION_COLORS`
