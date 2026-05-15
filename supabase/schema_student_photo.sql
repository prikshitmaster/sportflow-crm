-- Add photo_url column to students table
-- Run this in Supabase SQL Editor

ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
