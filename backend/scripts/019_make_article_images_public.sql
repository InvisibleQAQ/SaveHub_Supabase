-- =====================================================
-- Migration: Make Article Images Bucket Public
-- Description: Change article-images bucket to public access
--              so frontend can render <img src> without signed URLs
-- Prerequisite: 018_create_article_images_storage.sql
-- =====================================================

-- =============================================================================
-- Step 1: Update Bucket to Public
-- =============================================================================

UPDATE storage.buckets
SET public = true
WHERE id = 'article-images';

-- =============================================================================
-- Step 2: Replace SELECT Policy with Public Access
-- =============================================================================
-- Public bucket still respects RLS policies for SELECT
-- We need to allow anon role to read all images in this bucket

DROP POLICY IF EXISTS "article_images_select" ON storage.objects;

CREATE POLICY "article_images_select"
ON storage.objects FOR SELECT
TO public  -- includes both anon and authenticated
USING (bucket_id = 'article-images');

-- =============================================================================
-- Notes:
-- - INSERT/UPDATE/DELETE policies remain unchanged (authenticated + own folder)
-- - Service role (Celery) still bypasses RLS for uploads
-- - Public URLs: {SUPABASE_URL}/storage/v1/object/public/article-images/{path}
-- =============================================================================
