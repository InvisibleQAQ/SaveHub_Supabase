-- Migration: Remove deprecated auto_expand_content and auto_show_all_content columns
-- These settings are replaced by feeds.enable_auto_fetch_full_content

-- 1. Drop constraint first
ALTER TABLE public.feeds
  DROP CONSTRAINT IF EXISTS feeds_auto_expand_content_check;

-- 2. Drop columns
ALTER TABLE public.feeds
  DROP COLUMN IF EXISTS auto_expand_content;

ALTER TABLE public.settings
  DROP COLUMN IF EXISTS auto_show_all_content;
