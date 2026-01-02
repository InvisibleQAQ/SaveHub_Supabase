-- Migration: 026_create_article_repositories.sql
-- Purpose: Create junction table for many-to-many relationship between articles and repositories
-- Description: Stores links between articles and GitHub repositories extracted from article content

CREATE TABLE IF NOT EXISTS public.article_repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL,
  repository_id UUID NOT NULL,
  user_id UUID NOT NULL,
  extracted_url TEXT NOT NULL,  -- Original URL found in article content
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign keys
  CONSTRAINT article_repositories_article_fkey
    FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE,
  CONSTRAINT article_repositories_repository_fkey
    FOREIGN KEY (repository_id) REFERENCES public.repositories(id) ON DELETE CASCADE,
  CONSTRAINT article_repositories_user_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Prevent duplicate links between same article and repository
  CONSTRAINT article_repositories_unique UNIQUE (article_id, repository_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_article_repos_article_id
  ON public.article_repositories(article_id);
CREATE INDEX IF NOT EXISTS idx_article_repos_repository_id
  ON public.article_repositories(repository_id);
CREATE INDEX IF NOT EXISTS idx_article_repos_user_id
  ON public.article_repositories(user_id);

-- Enable Row Level Security
ALTER TABLE public.article_repositories ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own article_repositories
CREATE POLICY "Users can view own article_repositories"
  ON public.article_repositories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own article_repositories"
  ON public.article_repositories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own article_repositories"
  ON public.article_repositories FOR DELETE
  USING (auth.uid() = user_id);

-- Comment for documentation
COMMENT ON TABLE public.article_repositories IS
  'Junction table linking articles to GitHub repositories extracted from article content';
COMMENT ON COLUMN public.article_repositories.extracted_url IS
  'The original GitHub URL found in the article content';
