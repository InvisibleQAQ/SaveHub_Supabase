-- 更新向量搜索函数，支持同时搜索 articles 和 repositories
-- 用于 Self-RAG Chat 功能

-- 删除旧函数（如果存在）
DROP FUNCTION IF EXISTS search_all_embeddings(vector(1536), uuid, int, uuid, float);

-- 创建新的向量搜索函数
CREATE OR REPLACE FUNCTION search_all_embeddings(
    query_embedding vector(1536),
    match_user_id uuid,
    match_count int DEFAULT 10,
    match_feed_id uuid DEFAULT NULL,
    min_similarity float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    article_id uuid,
    repository_id uuid,
    chunk_index int,
    content text,
    score float,
    article_title text,
    article_url text,
    repository_name text,
    repository_url text
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
        a.title AS article_title,
        a.url AS article_url,
        r.name AS repository_name,
        r.html_url AS repository_url
    FROM all_embeddings e
    LEFT JOIN articles a ON e.article_id = a.id
    LEFT JOIN repositories r ON e.repository_id = r.id
    WHERE e.user_id = match_user_id
      AND (match_feed_id IS NULL OR a.feed_id = match_feed_id)
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION search_all_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_all_embeddings TO service_role;
