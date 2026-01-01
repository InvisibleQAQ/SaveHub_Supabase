-- Migration: Add AI analysis and custom edit fields to repositories table
-- Run this in Supabase SQL Editor

-- AI analysis fields
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS ai_tags TEXT[];
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS ai_platforms TEXT[];
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS analysis_failed BOOLEAN DEFAULT FALSE;

-- Custom edit fields
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS custom_description TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS custom_tags TEXT[];
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS custom_category TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_edited TIMESTAMPTZ;
