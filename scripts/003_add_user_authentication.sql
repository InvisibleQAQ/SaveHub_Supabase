-- =====================================================
-- Migration: Add User Authentication & Multi-tenancy
-- Description: Add user_id to all tables, enable RLS,
--              create settings table with auto-initialization
-- =====================================================

-- Step 1: Modify existing settings table to use user_id instead of id
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings DROP COLUMN IF EXISTS id;
ALTER TABLE settings ADD COLUMN user_id UUID;
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (user_id);
ALTER TABLE settings ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Add user_id columns to existing tables
ALTER TABLE folders ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE feeds ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE articles ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 3: Set NOT NULL constraints (safe since tables are empty)
ALTER TABLE folders ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE feeds ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE articles ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Create indexes for query performance
CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_feeds_user_id ON feeds(user_id);
CREATE INDEX idx_articles_user_id ON articles(user_id);
CREATE INDEX idx_articles_user_feed ON articles(user_id, feed_id);

-- Step 5: Enable Row Level Security
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- Step 6: Create RLS Policies (users can only access their own data)
CREATE POLICY settings_user_isolation ON settings
  FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY folders_user_isolation ON folders
  FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY feeds_user_isolation ON feeds
  FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY articles_user_isolation ON articles
  FOR ALL
  USING (auth.uid() = user_id);

-- Step 7: Create trigger function for default settings
CREATE OR REPLACE FUNCTION create_default_user_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO settings (
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Attach trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_user_settings();

-- =====================================================
-- Verification Queries (run after migration)
-- =====================================================
-- Check RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- Check policies exist:
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
--
-- Verify trigger exists:
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'users';
