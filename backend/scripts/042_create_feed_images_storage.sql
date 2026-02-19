-- =====================================================
-- Migration: Create Feed Images Storage Infrastructure
-- Description: Set up Supabase Storage bucket for feed icons/images
--              Public bucket, service role upload, path: {user_id}/{feed_id}/{hash}.{ext}
-- Prerequisite: 018_create_article_images_storage.sql (pattern reference)
-- =====================================================

-- =============================================================================
-- Step 1: Create Storage Bucket (public, same MIME types as article-images)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feed-images',
  'feed-images',
  true,
  5242880,
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

DROP POLICY IF EXISTS "feed_images_select" ON storage.objects;
DROP POLICY IF EXISTS "feed_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "feed_images_update" ON storage.objects;
DROP POLICY IF EXISTS "feed_images_delete" ON storage.objects;

CREATE POLICY "feed_images_select"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'feed-images');

CREATE POLICY "feed_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'feed-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "feed_images_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'feed-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'feed-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "feed_images_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'feed-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
