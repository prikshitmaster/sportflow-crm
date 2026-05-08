-- ── Permissions System Migration ────────────────────────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. User permissions — stores portal access role + permissions per user
CREATE TABLE IF NOT EXISTS user_permissions (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  academy_id   uuid        NOT NULL,
  name         text,
  access_role  text        NOT NULL,
  permissions  text[]      DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

-- 2. Staff invites — one-time use invite links (7-day expiry)
CREATE TABLE IF NOT EXISTS staff_invites (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  token        text        UNIQUE NOT NULL,
  academy_id   uuid        NOT NULL,
  academy_name text,
  name         text        NOT NULL,
  access_role  text        NOT NULL,
  permissions  text[]      DEFAULT '{}',
  expires_at   timestamptz NOT NULL,
  used         boolean     DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- 3. Allow the DB role stored in profiles to include new values
-- (no schema change needed — profiles.role is text, any value is accepted)

-- 4. Optional: index for faster academy lookups
CREATE INDEX IF NOT EXISTS user_permissions_academy_id_idx ON user_permissions (academy_id);
CREATE INDEX IF NOT EXISTS staff_invites_academy_id_idx    ON staff_invites    (academy_id);
CREATE INDEX IF NOT EXISTS staff_invites_token_idx         ON staff_invites    (token);

-- 5. Ground column on batches (if not already added)
ALTER TABLE batches ADD COLUMN IF NOT EXISTS ground text;

-- 6. Photo URL on staff table
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url text;

-- 7. Academy branches — owner-managed list of sports/branches shown on Dashboard
CREATE TABLE IF NOT EXISTS academy_branches (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (academy_id, name)
);
CREATE INDEX IF NOT EXISTS academy_branches_academy_id_idx ON academy_branches (academy_id);
