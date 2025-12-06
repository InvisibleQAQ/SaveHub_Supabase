-- Add sidebar_pinned column to settings table
-- This allows users to pin the sidebar to prevent auto-collapse

-- Add sidebar_pinned column
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS sidebar_pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- Update existing rows to have the default value
UPDATE settings
SET sidebar_pinned = FALSE
WHERE sidebar_pinned IS NULL;
