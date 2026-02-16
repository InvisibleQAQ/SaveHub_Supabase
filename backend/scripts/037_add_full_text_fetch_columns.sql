-- =====================================================
-- Migration 037: Add Full Text Fetch Fields
-- Description:
--   1) articles: full_content persistence fields
--   2) settings: global full text feature flags
--   3) feeds: per-feed auto expand override
-- Notes:
--   - Idempotent (IF NOT EXISTS + guarded CHECK)
--   - Run in Supabase SQL Editor
-- =====================================================

BEGIN;

-- 1) Articles: persist fetched full HTML content
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS full_content TEXT,
  ADD COLUMN IF NOT EXISTS full_content_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.articles.full_content IS
  'Full article HTML extracted from source URL by readability-lxml';
COMMENT ON COLUMN public.articles.full_content_fetched_at IS
  'Timestamp when full_content was last fetched';

-- 2) Settings: global switches (per user, single row)
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS full_text_fetch_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_show_all_content BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.settings.full_text_fetch_enabled IS
  'Global switch: allow full text fetch endpoint when true';
COMMENT ON COLUMN public.settings.auto_show_all_content IS
  'Global default for automatically showing full content in reader';

-- 3) Feeds: per-feed override
ALTER TABLE public.feeds
  ADD COLUMN IF NOT EXISTS auto_expand_content VARCHAR(16) NOT NULL DEFAULT 'global';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feeds_auto_expand_content_check'
  ) THEN
    ALTER TABLE public.feeds
      ADD CONSTRAINT feeds_auto_expand_content_check
      CHECK (auto_expand_content IN ('global', 'enabled', 'disabled'));
  END IF;
END $$;

COMMENT ON COLUMN public.feeds.auto_expand_content IS
  'Per-feed override: global | enabled | disabled';

COMMIT;
