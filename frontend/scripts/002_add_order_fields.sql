-- Add order field to folders table
ALTER TABLE folders ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

-- Add order field to feeds table
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

-- Initialize order values for existing folders based on created_at
WITH ordered_folders AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as row_num
  FROM folders
)
UPDATE folders
SET "order" = ordered_folders.row_num
FROM ordered_folders
WHERE folders.id = ordered_folders.id;

-- Initialize order values for existing feeds based on folder_id and created_at
WITH ordered_feeds AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY created_at) as row_num
  FROM feeds
)
UPDATE feeds
SET "order" = ordered_feeds.row_num
FROM ordered_feeds
WHERE feeds.id = ordered_feeds.id;

-- Create indexes for order fields
CREATE INDEX IF NOT EXISTS idx_folders_order ON folders("order");
CREATE INDEX IF NOT EXISTS idx_feeds_folder_order ON feeds(folder_id, "order");