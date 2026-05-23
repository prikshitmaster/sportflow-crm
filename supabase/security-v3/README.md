# security-v3 — Branch & Sport Isolation

Sibling folder to `supabase/migrations/`. Kept separate so the 88-file migration history
stays untouched and the audit work is reviewable as one unit.

## Status

| Phase | Goal | Files | State |
|---|---|---|---|
| Phase 1 | Branch enforcement on all secure_* write RPCs. Owners + branch-less staff unrestricted. Branch-scoped staff cannot write to other branches. | `01_actor_branch_helper.sql`, `02_branch_writes_core.sql`, `03_branch_writes_extended.sql` | ✅ applied |
| Phase 2 | Login + session validation moved to RPCs. Sets up Phase 3 by removing the last reason anon SELECT must stay open on `staff_auth` / `staff_sessions` / `student_sessions`. | `04_auth_rpcs.sql` | ✅ applied |
| Phase 3.1 | Lock session tables (anon SELECT/INSERT/DELETE all blocked, RPC-only). | `05_lock_session_tables.sql` | ✅ applied |
| Phase 3.2 | Lock staff_auth + staff_profiles. Password_hash leak sealed. Owner-scoped policy added for Staff Management page. New RPC `secure_fetch_next_staff_code` replaces direct staff_auth read. | `06_lock_staff_auth_tables.sql` | ✅ applied |
| Phase 3.3a | Drop USING(true) shadow on payments, batches, announcements (their scoped *_anon_read policies already existed). | `07_lock_easy_tenant_reads.sql` | ✅ applied |
| Phase 3.3b | Scoped policies created for attendance, trials, and 19 more tenant tables (staff, events, tournament_matches, session_plans, session_phases, sport_branches, academy_branches, trial_sources, activity_sessions, fee_plans, skill_assessments, player_goals, drill_favorites, drills, staff_attendance, leave_requests, student_batches, staff_invites, user_permissions). Legacy wide-open policies dropped. | `08_lock_attendance_trials.sql`, `09_lock_remaining_tenant_reads.sql`, `10_drop_legacy_open_shadows.sql` | ✅ applied |
| Phase 3.4a | `students` table locked. New RPCs `secure_fetch_student_batchmates` and `secure_fetch_batch_students` replace direct table reads in StudentStats / SessionPlanner. `students_anon_read` now allows only own row or staff-academy. | `11_lock_students_with_batchmate_rpc.sql` | ✅ applied |
| Phase 3.4b | Final 8 stragglers locked: audit_logs, academies, feature_flags, notifications, push_subscriptions, session_feedback, student_badges, payment_links. Only `gate_qr` left wide-open by design. | `12_lock_final_stragglers.sql` | ✅ applied |

## Server-side regression suite

```
node scripts/test-security-v3.mjs
```
17 assertions covering every locked table. Run after every migration.

## How to apply

```
node scripts/db-fast.mjs apply-dir supabase/security-v3
```

This connects once to the Tokyo pooler and applies every `.sql` file in numeric order.
Rollback files (`*_rollback.sql`) are stored alongside but are not auto-applied.

## What Phase 1 changes — concretely

1. `current_actor(p_token)` is dropped and recreated with one additional column,
   `branch_id UUID`. Existing callers that do `SELECT * INTO a FROM current_actor(...)`
   keep working — they now also get `a.branch_id` available.
2. Helper `_require_branch_scope(actor_kind, actor_branch, target_branch)` raises
   `42501 'forbidden: cross-branch'` if a branch-scoped staff tries to act on a row
   from another branch. Owners + NULL-branch staff bypass.
3. Every branch-scopable secure_* write RPC gains a branch check after its existing
   academy check. For inserts that take a `branch_id` parameter (batches, announcements,
   trials), if the caller is branch-scoped the param is overridden to their own branch.

## What Phase 1 does NOT change

- Read-side policies (still wide-open anon SELECT — that's Phase 3).
- RPC signatures (no client changes needed).
- Existing data (no UPDATE/DELETE on existing rows).
- Owner / office-staff behavior (both remain academy-wide).
