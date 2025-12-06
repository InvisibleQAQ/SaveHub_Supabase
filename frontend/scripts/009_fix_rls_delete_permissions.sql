-- =====================================================
-- Migration: Fix RLS DELETE Permissions
-- Issue: DELETE operations were failing silently due to
--        missing WITH CHECK clauses in RLS policies
-- =====================================================

-- Drop existing policies that lack proper DELETE permissions
DROP POLICY IF EXISTS settings_user_isolation ON settings;
DROP POLICY IF EXISTS folders_user_isolation ON folders;
DROP POLICY IF EXISTS feeds_user_isolation ON feeds;
DROP POLICY IF EXISTS articles_user_isolation ON articles;

-- Recreate policies with explicit USING and WITH CHECK clauses
-- This ensures both read visibility AND write permissions work correctly

CREATE POLICY settings_user_isolation ON settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY folders_user_isolation ON folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY feeds_user_isolation ON feeds
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY articles_user_isolation ON articles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- Verification Queries
-- =====================================================
-- Run these to confirm policies are correct:
--
-- SELECT schemaname, tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
--
-- Expected output should show:
-- - cmd = '*' (applies to all operations)
-- - qual = (auth.uid() = user_id) (USING clause)
-- - with_check = (auth.uid() = user_id) (WITH CHECK clause)
