-- Add position column to students table
-- Run this in Supabase SQL Editor

ALTER TABLE students ADD COLUMN IF NOT EXISTS position TEXT;

-- Valid values: GK, RB, CB, LB, DM, CM, AM, RW, LW, ST, CF
-- Null = position not yet assigned
