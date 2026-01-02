-- Migration: 028_add_repos_extracted_status.sql
-- Purpose: Add repository extraction status tracking to articles table
-- Description: Track whether GitHub repos have been extracted from article content

-- Add extraction status fields
-- repos_extracted: NULL=not yet extracted, TRUE=success, FALSE=failed
ALTER TABLE public.articles
ADD COLUMN IF NOT EXISTS repos_extracted BOOLEAN,
ADD COLUMN IF NOT EXISTS repos_extracted_at TIMESTAMPTZ;

-- Index for finding articles that need repo extraction
-- Condition: images_processed = true AND repos_extracted IS NULL
CREATE INDEX IF NOT EXISTS idx_articles_repos_unextracted
  ON public.articles(created_at DESC)
  WHERE repos_extracted IS NULL;

-- Comments for documentation
COMMENT ON COLUMN public.articles.repos_extracted IS
  'NULL=not yet extracted, TRUE=extraction succeeded, FALSE=extraction failed';
COMMENT ON COLUMN public.articles.repos_extracted_at IS
  'Timestamp of last extraction attempt';
