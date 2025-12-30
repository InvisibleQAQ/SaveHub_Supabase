-- =====================================================
-- Migration: Create Article Images Storage Infrastructure
-- Description: Set up Supabase Storage bucket for article images
--              with RLS policies and processing status tracking
-- Requirements:
--   - Private bucket (authenticated access only)
--   - Path: {user_id}/{article_id}/{image_hash}.{ext}
--   - 10MB file size limit
--   - User can only access own images
--   - Service role (Celery) can upload/delete (bypasses RLS)
-- =====================================================

-- =============================================================================
-- Step 1: Create Storage Bucket
-- =============================================================================
-- Note: If bucket already exists, update its settings

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'article-images',
  'article-images',
  false,  -- private bucket (requires auth)
  10485760,  -- 10MB in bytes
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
    'image/bmp',
    'image/jpg'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- Step 2: RLS Policies for storage.objects
-- =============================================================================
-- Path structure: {user_id}/{article_id}/{image_hash}.{ext}
-- The first folder segment is the user_id, which we compare against auth.uid()
--
-- Note: Service role (used by Celery) bypasses RLS automatically,
--       so we only need policies for authenticated user access.

-- Drop existing policies if any (for clean re-run)
DROP POLICY IF EXISTS "article_images_select" ON storage.objects;
DROP POLICY IF EXISTS "article_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "article_images_update" ON storage.objects;
DROP POLICY IF EXISTS "article_images_delete" ON storage.objects;

-- Policy: Users can SELECT (view/download) their own images
CREATE POLICY "article_images_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'article-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can INSERT their own images
CREATE POLICY "article_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'article-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can UPDATE their own images
CREATE POLICY "article_images_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'article-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'article-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can DELETE their own images
CREATE POLICY "article_images_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'article-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- =============================================================================
-- Step 3: Add Processing Status Columns to Articles Table
-- =============================================================================
-- Track whether article images have been processed
-- - NULL: Not yet processed (default for existing/new articles)
-- - true: Images processed (content updated with storage URLs)
-- - false: Processing attempted but all images failed

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS images_processed BOOLEAN DEFAULT NULL;

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS images_processed_at TIMESTAMPTZ DEFAULT NULL;

-- Comment for documentation
COMMENT ON COLUMN articles.images_processed IS
  'Image processing status: NULL=not processed, true=completed, false=all failed';
COMMENT ON COLUMN articles.images_processed_at IS
  'Timestamp when image processing completed';

-- =============================================================================
-- Step 4: Index for Efficient Celery Queries
-- =============================================================================
-- Partial index only includes unprocessed articles for Celery to pick up

CREATE INDEX IF NOT EXISTS idx_articles_images_unprocessed
ON articles(created_at DESC)
WHERE images_processed IS NULL;
