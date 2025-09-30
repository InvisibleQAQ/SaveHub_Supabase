-- Create folders table
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create feeds table
CREATE TABLE IF NOT EXISTS feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_fetched TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create articles table
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL,
  author TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'app-settings',
  theme TEXT NOT NULL DEFAULT 'system',
  font_size INTEGER NOT NULL DEFAULT 16,
  auto_refresh BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_interval INTEGER NOT NULL DEFAULT 30,
  articles_retention_days INTEGER NOT NULL DEFAULT 30,
  mark_as_read_on_scroll BOOLEAN NOT NULL DEFAULT FALSE,
  show_thumbnails BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_feeds_folder_id ON feeds(folder_id);
CREATE INDEX IF NOT EXISTS idx_feeds_url ON feeds(url);
CREATE INDEX IF NOT EXISTS idx_feeds_last_fetched ON feeds(last_fetched);

CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
CREATE INDEX IF NOT EXISTS idx_articles_is_starred ON articles(is_starred);
CREATE INDEX IF NOT EXISTS idx_articles_feed_published ON articles(feed_id, published_at);

-- Insert default settings if not exists
INSERT INTO settings (id, theme, font_size, auto_refresh, refresh_interval, articles_retention_days, mark_as_read_on_scroll, show_thumbnails)
VALUES ('app-settings', 'system', 16, TRUE, 30, 30, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;
