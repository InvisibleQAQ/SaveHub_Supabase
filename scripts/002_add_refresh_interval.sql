-- Migration: Add refresh_interval column to feeds table
-- Purpose: Allow per-feed refresh interval configuration
-- Default: 60 minutes (will be overridden by app using global settings.refreshInterval)

-- Add refresh_interval column with validation
ALTER TABLE feeds
ADD COLUMN IF NOT EXISTS refresh_interval INTEGER NOT NULL DEFAULT 60
CHECK (refresh_interval > 0 AND refresh_interval <= 10080);  -- 1 minute to 1 week

-- Comment for documentation
COMMENT ON COLUMN feeds.refresh_interval IS 'Refresh interval in minutes. Must be between 1 and 10080 (1 week). Defaults to 60 minutes, but app will use global settings value for new feeds.';

-- Index for efficient filtering by refresh interval (optional, only if needed for queries)
-- CREATE INDEX IF NOT EXISTS idx_feeds_refresh_interval ON feeds(refresh_interval);
