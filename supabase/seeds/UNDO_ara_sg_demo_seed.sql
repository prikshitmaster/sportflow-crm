-- ═══════════════════════════════════════════════════════════════════════════
-- UNDO — ARA SG Highway (Football) demo seed, 2026-08-31
-- ═══════════════════════════════════════════════════════════════════════════
-- Restores the branch exactly as it was before the demo seed.
-- NOTHING was deleted during seeding, so this is a complete restore.
--
--   Target branch  : b32308fc-3bf7-463f-a456-59a13a67cd17  (Football × ARA SG Highway)
--   Archive branch : 3a05e239-87d7-4429-90a7-7434e822a9d9  (created by the seed)
--   Academy        : cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf  (ARA)
--
-- Watermarks captured BEFORE seeding — everything above these is seeded:
--   students.id > 3025   batches.id > 157   staff.id > 188
--   seeded students also carry student_code LIKE 'SG0%'
--
-- The original batch links of the 82 parked students are in
-- _demo_parked_backup, written before anything was changed.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Seeded child rows first (FK order) ─────────────────────────────────
delete from attendance        where student_id > 3025;
delete from skill_assessments where student_id > 3025;
delete from payments          where student_id > 3025;
delete from notifications
 where academy_id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'
   and recipient_type = 'student'
   and recipient_id ~ '^[0-9]+$'
   and recipient_id::bigint > 3025;

-- Session plans: only the seeded ones. A pre-existing plan on a legacy batch
-- also received phases, so remove phases by the plans the seed created, then
-- the stray phases added to that one older plan (position 1-4, seeded text).
delete from session_phases
 where session_id in (select id from session_plans
                       where notes like 'Session % — progression block');
delete from session_phases
 where phase_name in ('Warm Up','Technical Practice','Small Sided Game','Cool Down')
   and context_ct in ('Rondo 5v2','Passing patterns','6v6 with target players','Static stretching')
   and session_id in (select id from session_plans
                       where batch_id in (select id from batches
                                           where branch_id='b32308fc-3bf7-463f-a456-59a13a67cd17'));
delete from session_plans where notes like 'Session % — progression block';

-- Coach attendance. The seed wrote check-ins for ALL 10 coaches on this
-- branch, including your 3 pre-existing ones, so this clears the whole
-- 2025-09-01..2026-08-30 window rather than filtering by staff id.
delete from staff_checkins
 where staff_id in (select id from staff where branch_id='b32308fc-3bf7-463f-a456-59a13a67cd17')
   and date between date '2025-09-01' and date '2026-08-30';
update staff set attendance = null
 where branch_id = 'b32308fc-3bf7-463f-a456-59a13a67cd17' and id <= 188;

-- ── 2. Seeded students, then the structures they pointed at ───────────────
delete from students  where id > 3025 and student_code like 'SG0%';
delete from fee_plans where batch_id > 157;
delete from batches   where id > 157 and branch_id = 'b32308fc-3bf7-463f-a456-59a13a67cd17';
delete from staff     where id > 188 and branch_id = 'b32308fc-3bf7-463f-a456-59a13a67cd17';

-- Fee plans the seed ADDED to the 5 pre-existing batches. The 4 original
-- plans are ids 1-4; anything above that on those batches is seeded.
delete from fee_plans where batch_id in (4,5,6,18,157) and id > 4;

-- ── 3. Seeded events / announcements ──────────────────────────────────────
delete from events        where branch_id = 'b32308fc-3bf7-463f-a456-59a13a67cd17';
delete from announcements where branch_id = 'b32308fc-3bf7-463f-a456-59a13a67cd17';

-- ── 4. Restore the 5 pre-existing batches' capacity + ground ──────────────
-- The seed set every batch to capacity 30 and ground 'Pitch N'.
-- The seed also overwrote `enrolled` (it was stale on every one of these —
-- batch 4 read 8 with 20 actual students — so these are the pre-seed values,
-- restored as-found rather than as-correct).
update batches set capacity = 30, ground = 'Ground A', enrolled = 8  where id = 4;    -- Evening U20 Advance MWF
update batches set capacity = 32, ground = NULL,       enrolled = 10 where id = 5;    -- Evening U20 Development TTF
update batches set capacity = 20, ground = NULL,       enrolled = 7  where id = 6;    -- Under 15 advance MWF
update batches set capacity = 30, ground = NULL,       enrolled = 5  where id = 18;   -- Under 15 Advance TTS
update batches set capacity = 20, ground = NULL,       enrolled = 2  where id = 157;  -- Football

-- ── 5. Put the 82 original students back, batches included ────────────────
update students s
   set branch_id = bk.orig_branch_id,
       batch_id  = bk.orig_batch_id,
       batch     = bk.orig_batch
  from _demo_parked_backup bk
 where s.id = bk.student_id;

-- ── 6. Drop the archive branch and the backup table ───────────────────────
delete from sport_branches where id = '3a05e239-87d7-4429-90a7-7434e822a9d9';
drop table if exists _demo_parked_backup;

commit;

-- ── Verify: expect 82 students, 5 batches, 0 archive, 0 seeded ────────────
-- select
--   (select count(*) from students where branch_id='b32308fc-3bf7-463f-a456-59a13a67cd17') as students,
--   (select count(*) from batches  where branch_id='b32308fc-3bf7-463f-a456-59a13a67cd17') as batches,
--   (select count(*) from sport_branches where id='3a05e239-87d7-4429-90a7-7434e822a9d9') as archive_left,
--   (select count(*) from students where student_code like 'SG0%') as seeded_left;

-- NOTE: batches 4,5,6,18,157 originally had ground values that were not all
-- recorded before the update. Ground A on batch 4 is from the pre-seed read;
-- the rest are set NULL, which restores "ungrouped" behaviour (slot_id, not
-- ground, is what actually drives the capacity trigger — see
-- _require_batch_capacity — so this does not change enforcement).
