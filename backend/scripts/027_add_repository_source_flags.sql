-- Migration: 027_add_repository_source_flags.sql
-- Purpose: Add source tracking flags to repositories table
-- Description: Track whether a repository came from GitHub starred sync or article extraction

-- Add source tracking boolean flags
ALTER TABLE public.repositories
ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_extracted BOOLEAN DEFAULT FALSE;

-- Backfill existing data: all current repos are from starred sync
UPDATE public.repositories
SET is_starred = TRUE
WHERE is_starred IS NULL OR is_starred = FALSE;

-- Index for filtering extracted repositories
CREATE INDEX IF NOT EXISTS idx_repositories_is_extracted
  ON public.repositories(is_extracted)
  WHERE is_extracted = TRUE;

-- Index for filtering starred repositories
CREATE INDEX IF NOT EXISTS idx_repositories_is_starred
  ON public.repositories(is_starred)
  WHERE is_starred = TRUE;

-- Comments for documentation
COMMENT ON COLUMN public.repositories.is_starred IS
  'TRUE if repository was synced from user GitHub starred repos';
COMMENT ON COLUMN public.repositories.is_extracted IS
  'TRUE if repository was extracted from article content';
