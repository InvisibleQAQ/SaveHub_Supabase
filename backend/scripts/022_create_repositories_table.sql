-- =====================================================
-- Migration: Create repositories table
-- Description: Store user's GitHub starred repositories
-- =====================================================

-- repositories 表存储用户 starred 仓库
CREATE TABLE IF NOT EXISTS public.repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT,
  html_url TEXT NOT NULL,
  stargazers_count INTEGER DEFAULT 0,
  language TEXT,
  topics TEXT[] DEFAULT '{}',
  owner_login TEXT NOT NULL,
  owner_avatar_url TEXT,
  starred_at TIMESTAMPTZ,
  github_created_at TIMESTAMPTZ,
  github_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT repositories_user_github_unique UNIQUE (user_id, github_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_repositories_user_id ON public.repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_repositories_language ON public.repositories(language);
CREATE INDEX IF NOT EXISTS idx_repositories_starred_at ON public.repositories(starred_at DESC);

-- RLS 策略
ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repositories"
  ON public.repositories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repositories"
  ON public.repositories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repositories"
  ON public.repositories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own repositories"
  ON public.repositories FOR DELETE
  USING (auth.uid() = user_id);
