-- 029_rename_article_embeddings_to_all_embeddings.sql
-- 将 article_embeddings 表重命名为 all_embeddings
--
-- 目的: 支持未来存储非文章类型的 embeddings
-- 风险: 低 - PostgreSQL RENAME 是原子操作，不会丢失数据
--
-- 依赖: 020_create_article_embeddings.sql

-- ============================================================================
-- 1. 重命名表
-- ============================================================================

ALTER TABLE IF EXISTS article_embeddings RENAME TO all_embeddings;

-- ============================================================================
-- 2. 重命名索引
-- ============================================================================

ALTER INDEX IF EXISTS idx_embeddings_article RENAME TO idx_all_embeddings_source;
ALTER INDEX IF EXISTS idx_embeddings_user RENAME TO idx_all_embeddings_user;
ALTER INDEX IF EXISTS idx_embeddings_user_article RENAME TO idx_all_embeddings_user_source;
ALTER INDEX IF EXISTS idx_embeddings_vector RENAME TO idx_all_embeddings_vector;

-- ============================================================================
-- 3. 重建 RLS 策略 (PostgreSQL 不支持 RENAME POLICY)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own embeddings" ON all_embeddings;
CREATE POLICY "Users can view own embeddings"
  ON all_embeddings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access" ON all_embeddings;
CREATE POLICY "Service role full access"
  ON all_embeddings
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 4. 更新 RPC 函数
-- ============================================================================

-- 删除旧函数
DROP FUNCTION IF EXISTS search_article_embeddings(vector(1536), uuid, int, uuid, float);

-- 创建新函数
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
    chunk_index int,
    content_type text,
    content text,
    source_url text,
    score float,
    article_title text,
    article_url text
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
        e.chunk_index,
        e.content_type,
        e.content,
        e.source_url,
        1 - (e.embedding <=> query_embedding) AS score,
        a.title AS article_title,
        a.url AS article_url
    FROM all_embeddings e
    JOIN articles a ON e.article_id = a.id
    WHERE e.user_id = match_user_id
      AND (match_feed_id IS NULL OR a.feed_id = match_feed_id)
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION search_all_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_all_embeddings TO service_role;

-- ============================================================================
-- 5. 更新表注释
-- ============================================================================

COMMENT ON TABLE all_embeddings IS 'RAG 向量嵌入存储：支持文章及其他内容类型的语义分块';
COMMENT ON COLUMN all_embeddings.chunk_index IS '在原文中的顺序，0-based';
COMMENT ON COLUMN all_embeddings.content IS '文本内容（含图片描述，格式为 [图片描述: ...]）';
COMMENT ON COLUMN all_embeddings.embedding IS '1536 维向量嵌入 (OpenAI text-embedding-3-small 兼容)';
COMMENT ON COLUMN all_embeddings.metadata IS '扩展元数据 JSON';
