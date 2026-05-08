-- ============================================================
-- SportFlow CRM — Schema v3
-- Run this AFTER schema_v2.sql
-- Adds: academies, profiles, feature_flags
-- ============================================================

-- ── Academies ────────────────────────────────────────────
-- One row per sports academy (one owner per academy)
create table if not exists academies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null,         -- Supabase auth.users.id of the owner
  join_code   char(6) not null unique, -- staff use this code to link their account
  created_at  timestamptz default now()
);

-- ── Profiles ─────────────────────────────────────────────
-- One row per Supabase-auth user (owner or staff)
-- Students use the separate custom auth (student_sessions table)
create table if not exists profiles (
  id          uuid primary key,      -- same UUID as auth.users.id
  role        text not null check (role in ('owner','staff')),
  academy_id  uuid references academies(id) on delete cascade,
  name        text not null,
  phone       text,
  created_at  timestamptz default now()
);

-- ── Feature Flags ─────────────────────────────────────────
-- Owner can enable / disable modules for the whole academy.
-- If a row is missing for a feature, treat as enabled (default-on).
-- Supported features:
--   attendance, payments, trials, batches, staff,
--   reports, community, events, gate_qr
create table if not exists feature_flags (
  academy_id  uuid not null references academies(id) on delete cascade,
  feature     text not null,
  enabled     boolean default true,
  primary key (academy_id, feature)
);

-- ── Leave Requests ───────────────────────────────────────
-- Staff submit; owner approves or rejects
create table if not exists leave_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid,                     -- profiles.id of the staff member
  staff_name  text not null,
  start_date  date not null,
  end_date    date not null,
  reason      text not null,
  status      text default 'Pending' check (status in ('Pending','Approved','Rejected')),
  created_at  timestamptz default now()
);

-- ── RLS (keep off for now — same as other tables) ─────────
alter table academies      disable row level security;
alter table profiles       disable row level security;
alter table feature_flags  disable row level security;
alter table leave_requests disable row level security;
