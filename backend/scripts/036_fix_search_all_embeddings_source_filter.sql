-- =====================================================
-- Migration: Fix search_all_embeddings source/feed filtering
-- Description:
--   1) Add optional source_type filter support (article/repository)
--   2) Fix repository rows being excluded when match_feed_id is set
-- =====================================================

-- 删除旧签名（兼容不同版本）
DROP FUNCTION IF EXISTS search_all_embeddings(vector(1536), uuid, int, uuid, float);
DROP FUNCTION IF EXISTS search_all_embeddings(vector(1536), uuid, int, uuid, float, text);

-- 重建函数：支持 source_type，并修复 feed 过滤逻辑
CREATE OR REPLACE FUNCTION search_all_embeddings(
    query_embedding vector(1536),
    match_user_id uuid,
    match_count int DEFAULT 10,
    match_feed_id uuid DEFAULT NULL,
    min_similarity float DEFAULT 0.0,
    match_source_type text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    article_id uuid,
    repository_id uuid,
    chunk_index int,
    content text,
    score float,
    -- Article fields
    article_title text,
    article_url text,
    -- Repository fields (expanded for reference cards)
    repository_name text,
    repository_url text,
    repository_owner_login text,
    repository_owner_avatar_url text,
    repository_stargazers_count int,
    repository_language text,
    repository_description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.article_id,
        e.repository_id,
        e.chunk_index,
        e.content,
        1 - (e.embedding <=> query_embedding) AS score,
        -- Article fields
        a.title AS article_title,
        a.url AS article_url,
        -- Repository fields
        r.name AS repository_name,
        r.html_url AS repository_url,
        r.owner_login AS repository_owner_login,
        r.owner_avatar_url AS repository_owner_avatar_url,
        r.stargazers_count AS repository_stargazers_count,
        r.language AS repository_language,
        r.description AS repository_description
    FROM all_embeddings e
    LEFT JOIN articles a ON e.article_id = a.id
    LEFT JOIN repositories r ON e.repository_id = r.id
    WHERE e.user_id = match_user_id
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity
      AND (
          match_source_type IS NULL
          OR lower(match_source_type) = ''
          OR (lower(match_source_type) = 'article' AND e.article_id IS NOT NULL)
          OR (lower(match_source_type) = 'repository' AND e.repository_id IS NOT NULL)
      )
      AND (
          match_feed_id IS NULL
          OR (e.article_id IS NOT NULL AND a.feed_id = match_feed_id)
          OR (
              e.repository_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM article_repositories ar
                  JOIN articles fa ON fa.id = ar.article_id
                  WHERE ar.repository_id = e.repository_id
                    AND ar.user_id = match_user_id
                    AND fa.user_id = match_user_id
                    AND fa.feed_id = match_feed_id
              )
          )
      )
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION search_all_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_all_embeddings TO service_role;
