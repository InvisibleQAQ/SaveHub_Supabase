-- =====================================================
-- Migration: Fix feeds url unique constraint
-- Description: Change from global UNIQUE(url) to user-scoped UNIQUE(user_id, url)
--              This allows different users to subscribe to the same feed URL
-- =====================================================

-- Step 1: Drop the old global unique constraint on url
-- The constraint name follows PostgreSQL convention: {table}_{column}_key
ALTER TABLE feeds DROP CONSTRAINT IF EXISTS feeds_url_key;

-- Step 2: Drop the old index if exists (may have been created separately)
DROP INDEX IF EXISTS idx_feeds_url;

-- Step 3: Add new composite unique constraint on (user_id, url)
-- This allows each user to have their own subscription to the same feed
ALTER TABLE feeds ADD CONSTRAINT feeds_user_url_unique UNIQUE (user_id, url);

-- Step 4: Create a composite index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_feeds_user_url ON feeds(user_id, url);

-- =====================================================
-- Verification Queries (run after migration)
-- =====================================================
-- Check new constraint exists:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'feeds'::regclass AND conname LIKE '%url%';
--
-- Check old constraint is gone:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'feeds'::regclass AND conname = 'feeds_url_key';
