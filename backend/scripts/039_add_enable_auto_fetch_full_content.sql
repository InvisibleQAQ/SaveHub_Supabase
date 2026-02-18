-- Add per-feed auto full text fetch toggle
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS enable_auto_fetch_full_content BOOLEAN NOT NULL DEFAULT FALSE;
