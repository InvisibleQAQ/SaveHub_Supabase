-- Migration: Add unique constraint on (feed_id, url) to prevent duplicate articles
-- Run this script in Supabase SQL editor

-- Step 1: Add unique constraint on (feed_id, url) combination
ALTER TABLE articles
ADD CONSTRAINT articles_feed_url_unique
UNIQUE (feed_id, url);

-- Step 2: Create index for faster lookups by url
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
