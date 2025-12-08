-- =====================================================
-- Migration: Fix Settings Trigger - Complete Solution
-- Description: Properly configure trigger to bypass RLS
-- Previous fix (012) failed because:
--   1. Subquery to auth.users fails due to RLS on that table
--   2. SECURITY DEFINER alone doesn't bypass RLS in Supabase
-- =====================================================

-- Step 1: Drop all existing settings policies (clean slate)
DROP POLICY IF EXISTS settings_user_isolation ON settings;
DROP POLICY IF EXISTS settings_select_own ON settings;
DROP POLICY IF EXISTS settings_update_own ON settings;
DROP POLICY IF EXISTS settings_delete_own ON settings;
DROP POLICY IF EXISTS settings_insert_for_user ON settings;

-- Step 2: Recreate the trigger function with proper configuration
-- Key: SECURITY DEFINER + SET search_path ensures it runs as function owner (postgres)
-- In Supabase, functions created in SQL Editor are owned by postgres, which bypasses RLS
CREATE OR REPLACE FUNCTION create_default_user_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.settings (
    user_id,
    theme,
    font_size,
    auto_refresh,
    refresh_interval,
    articles_retention_days,
    mark_as_read_on_scroll,
    show_thumbnails
  )
  VALUES (
    NEW.id,
    'system',
    16,
    TRUE,
    30,
    30,
    FALSE,
    TRUE
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Step 3: Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_user_settings();

-- Step 4: Create RLS policies for normal user operations (not trigger)
-- These policies use auth.uid() which works for authenticated requests

-- Allow users to read their own settings
CREATE POLICY settings_select_own ON settings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow users to update their own settings
CREATE POLICY settings_update_own ON settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow users to delete their own settings (if needed)
CREATE POLICY settings_delete_own ON settings
  FOR DELETE
  USING (auth.uid() = user_id);

-- INSERT policy for authenticated users (backup if trigger fails)
-- This allows a user to create their own settings if they don't exist
CREATE POLICY settings_insert_own ON settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- Verification Queries
-- =====================================================
-- Check function owner (should be postgres):
-- SELECT proname, proowner::regrole FROM pg_proc WHERE proname = 'create_default_user_settings';
--
-- Check trigger:
-- SELECT trigger_name, event_manipulation FROM information_schema.triggers
-- WHERE event_object_schema = 'auth' AND event_object_table = 'users';
--
-- Check policies:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'settings';
