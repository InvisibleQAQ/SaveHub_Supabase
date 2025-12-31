-- Add github_token column to settings table
-- This allows users to store their GitHub Personal Access Token for GitHub integrations

-- Add github_token column (nullable, as users may not set it)
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS github_token TEXT;

-- No default value needed - NULL indicates token not set
