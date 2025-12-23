-- =====================================================
-- Migration: Create api_configs table with type field
-- Description: Supports chat, embedding, and rerank API configurations
-- Each type can have multiple configs but only one active per user
-- =====================================================

-- Step 0: Drop existing table (clean slate)
DROP TABLE IF EXISTS public.api_configs CASCADE;

-- Step 1: Create table
CREATE TABLE IF NOT EXISTS public.api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_base TEXT NOT NULL,
  model TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'chat',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- type constraint: only chat/embedding/rerank allowed
  CONSTRAINT api_configs_type_check CHECK (type IN ('chat', 'embedding', 'rerank'))
);

-- Step 2: Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_api_configs_user_id ON api_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_configs_type ON api_configs(type);
CREATE INDEX IF NOT EXISTS idx_api_configs_created_at ON api_configs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_configs_is_active ON api_configs(is_active);

-- Partial unique index: only one active config per (user_id, type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_configs_single_active_per_type
  ON api_configs(user_id, type) WHERE is_active = TRUE;

-- Step 3: Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_api_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_configs_updated_at_trigger ON api_configs;
CREATE TRIGGER api_configs_updated_at_trigger
  BEFORE UPDATE ON api_configs
  FOR EACH ROW EXECUTE FUNCTION update_api_configs_updated_at();

-- Step 4: Row Level Security
ALTER TABLE api_configs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (for clean re-run)
DROP POLICY IF EXISTS "Users can view own api_configs" ON api_configs;
DROP POLICY IF EXISTS "Users can insert own api_configs" ON api_configs;
DROP POLICY IF EXISTS "Users can update own api_configs" ON api_configs;
DROP POLICY IF EXISTS "Users can delete own api_configs" ON api_configs;

-- Create RLS policies
CREATE POLICY "Users can view own api_configs"
  ON api_configs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own api_configs"
  ON api_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own api_configs"
  ON api_configs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own api_configs"
  ON api_configs FOR DELETE
  USING (auth.uid() = user_id);
