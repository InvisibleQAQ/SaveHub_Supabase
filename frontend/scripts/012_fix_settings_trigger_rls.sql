-- =====================================================
-- Migration: Fix Settings Trigger RLS Policy
-- Description: Allow the trigger function to insert into settings
--              when a new user is created in auth.users
-- Root Cause: on_auth_user_created trigger fails because auth.uid()
--             is NULL during trigger execution, causing RLS to block INSERT
-- =====================================================

-- Option 1: Add INSERT policy for trigger function
-- The trigger runs as SECURITY DEFINER, but RLS still applies.
-- We need to allow INSERT when user_id matches the NEW.id from trigger.

-- First, drop the existing catch-all policy that doesn't work for INSERT
DROP POLICY IF EXISTS settings_user_isolation ON settings;

-- Create separate policies for different operations
-- SELECT/UPDATE/DELETE: User can only access their own settings
CREATE POLICY settings_select_own ON settings
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY settings_update_own ON settings
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY settings_delete_own ON settings
  FOR DELETE
  USING (auth.uid() = user_id);

-- INSERT: Allow insert if user_id is a valid auth.users id
-- This allows the trigger function to insert for the newly created user
-- Using a permissive policy that checks user_id exists in auth.users
CREATE POLICY settings_insert_for_user ON settings
  FOR INSERT
  WITH CHECK (
    user_id IN (SELECT id FROM auth.users)
  );

-- =====================================================
-- Verification Query
-- =====================================================
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'settings';
