-- Migration: Add github_pushed_at column to repositories table
-- Purpose: Track last code push time for detecting README changes that need re-analysis

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS github_pushed_at TIMESTAMPTZ;

COMMENT ON COLUMN repositories.github_pushed_at IS 'Last code push time from GitHub API. Used to detect code changes for AI re-analysis.';
