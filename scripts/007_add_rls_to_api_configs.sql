-- =====================================================
-- Migration: Add RLS to API Configs Table
-- Description: Add user_id to api_configs table and enable RLS
-- =====================================================

-- Step 1: Add user_id column to api_configs table
ALTER TABLE api_configs ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Set NOT NULL constraint (safe since table should be empty for new feature)
ALTER TABLE api_configs ALTER COLUMN user_id SET NOT NULL;

-- Step 3: Create index for query performance
CREATE INDEX idx_api_configs_user_id ON api_configs(user_id);

-- Step 4: Enable Row Level Security
ALTER TABLE api_configs ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS Policy (users can only access their own API configs)
CREATE POLICY api_configs_user_isolation ON api_configs
  FOR ALL
  USING (auth.uid() = user_id);

-- =====================================================
-- Verification Queries (run after migration)
-- =====================================================
-- Check RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_configs';
--
-- Check policy exists:
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_configs';