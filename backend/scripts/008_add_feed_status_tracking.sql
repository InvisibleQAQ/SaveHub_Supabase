-- Migration: Add feed refresh status tracking
-- Purpose: Track RSS feed fetch success/failure to prevent infinite retry loops
-- Author: RSS Reader Team
-- Date: 2025-11-13

-- Add columns to track last fetch status
ALTER TABLE feeds
ADD COLUMN IF NOT EXISTS last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'failed')),
ADD COLUMN IF NOT EXISTS last_fetch_error TEXT;

-- Create index for querying failed feeds
CREATE INDEX IF NOT EXISTS idx_feeds_fetch_status ON feeds(last_fetch_status) WHERE last_fetch_status = 'failed';

-- Comments for documentation
COMMENT ON COLUMN feeds.last_fetch_status IS 'Status of last RSS fetch attempt: success, failed, or NULL (unknown)';
COMMENT ON COLUMN feeds.last_fetch_error IS 'Error message from last failed fetch (NULL if success or not fetched yet)';

-- Migration notes:
-- 1. Existing feeds will have NULL status (means "unknown" - will be set on next refresh)
-- 2. Failed feeds will still update last_fetched timestamp to prevent retry storms
-- 3. UI should show visual indicator for failed status
