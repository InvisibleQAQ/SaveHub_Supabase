-- =====================================================
-- Migration 038: Add fetch_status to articles
-- Description:
--   Tracks full-text fetch state: unfetched / success / failed
--   Backfills existing rows that have full_content to 'success'
-- Notes:
--   - Idempotent (IF NOT EXISTS + guarded CHECK)
--   - Run in Supabase SQL Editor
-- =====================================================

BEGIN;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS fetch_status TEXT NOT NULL DEFAULT 'unfetched';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_fetch_status_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_fetch_status_check
      CHECK (fetch_status IN ('unfetched', 'success', 'failed'));
  END IF;
END $$;

-- Backfill: existing rows with full_content are already fetched successfully
UPDATE public.articles
  SET fetch_status = 'success'
  WHERE full_content IS NOT NULL AND fetch_status = 'unfetched';

CREATE INDEX IF NOT EXISTS idx_articles_fetch_status
  ON public.articles(fetch_status)
  WHERE fetch_status IN ('unfetched', 'failed');

COMMENT ON COLUMN public.articles.fetch_status IS
  'Full-text fetch state: unfetched (default) | success | failed';

COMMIT;
