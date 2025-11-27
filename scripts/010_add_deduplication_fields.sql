-- Migration: Add article deduplication support
-- Purpose: Allow feeds to deduplicate articles based on title + content hash
-- Author: RSS Reader Team
-- Date: 2025-11-27

-- Add deduplication toggle to feeds table
ALTER TABLE feeds
ADD COLUMN IF NOT EXISTS enable_deduplication BOOLEAN NOT NULL DEFAULT false;

-- Add content hash column to articles table
-- Hash is computed from (title + content) using SHA-256
-- NULL when deduplication is disabled for the feed
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Create unique constraint to prevent duplicate articles
-- PostgreSQL allows multiple NULLs in unique constraints (NULL != NULL)
-- So this only enforces uniqueness when content_hash is set (deduplication enabled)
ALTER TABLE articles
ADD CONSTRAINT articles_feed_content_hash_unique UNIQUE (feed_id, content_hash);

-- Create index for fast hash lookups during article insertion
CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(feed_id, content_hash)
WHERE content_hash IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN feeds.enable_deduplication IS 'When true, articles with identical title+content will be deduplicated';
COMMENT ON COLUMN articles.content_hash IS 'SHA-256 hash of (title + content), NULL when deduplication disabled';
COMMENT ON CONSTRAINT articles_feed_content_hash_unique ON articles IS 'Prevents duplicate articles within same feed when deduplication enabled';

-- Migration notes:
-- 1. Existing feeds will have enable_deduplication = false (no behavior change)
-- 2. Existing articles will have content_hash = NULL (no deduplication)
-- 3. When a feed enables deduplication, new articles will compute and store hash
-- 4. Multiple NULL hashes are allowed (required for backward compatibility)
-- 5. Hash computation happens in application layer (lib/utils/hash.ts)
