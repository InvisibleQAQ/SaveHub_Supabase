-- 031_add_repository_embeddings.sql
-- 为 all_embeddings 表添加 repository_id 列，支持仓库向量嵌入
--
-- 依赖: 029_rename_article_embeddings_to_all_embeddings.sql
-- 设计: article_id 和 repository_id 互斥，一条记录只能属于其中一个

-- ============================================================================
-- 1. 添加 repository_id 列
-- ============================================================================

ALTER TABLE all_embeddings
ADD COLUMN IF NOT EXISTS repository_id UUID;

-- 添加外键约束（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_repository'
        AND table_name = 'all_embeddings'
    ) THEN
        ALTER TABLE all_embeddings
        ADD CONSTRAINT fk_repository
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- 2. 添加 repositories 表的 embedding 处理状态字段
-- ============================================================================

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS embedding_processed BOOLEAN;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS embedding_processed_at TIMESTAMPTZ;

-- 创建部分索引：仅索引待处理的仓库
CREATE INDEX IF NOT EXISTS idx_repositories_embedding_unprocessed
  ON repositories (created_at DESC)
  WHERE embedding_processed IS NULL AND readme_content IS NOT NULL;

-- ============================================================================
-- 3. 创建索引
-- ============================================================================

-- 按仓库查询
CREATE INDEX IF NOT EXISTS idx_all_embeddings_repository
  ON all_embeddings(repository_id);

-- 按用户+仓库联合查询
CREATE INDEX IF NOT EXISTS idx_all_embeddings_user_repository
  ON all_embeddings(user_id, repository_id);

-- ============================================================================
-- 4. 添加检查约束（article_id 和 repository_id 互斥）
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_source_exclusive'
        AND table_name = 'all_embeddings'
    ) THEN
        ALTER TABLE all_embeddings
        ADD CONSTRAINT chk_source_exclusive
        CHECK (
            (article_id IS NOT NULL AND repository_id IS NULL) OR
            (article_id IS NULL AND repository_id IS NOT NULL)
        );
    END IF;
END $$;

-- ============================================================================
-- 5. 更新 RPC 搜索函数（支持 repository 类型）
-- ============================================================================

DROP FUNCTION IF EXISTS search_all_embeddings(vector(1536), uuid, int, uuid, float);

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
    source_type text,
    source_title text,
    source_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    -- Article embeddings
    SELECT
        e.id,
        e.article_id,
        NULL::uuid AS repository_id,
        e.chunk_index,
        e.content,
        1 - (e.embedding <=> query_embedding) AS score,
        'article'::text AS source_type,
        a.title AS source_title,
        a.url AS source_url
    FROM all_embeddings e
    JOIN articles a ON e.article_id = a.id
    WHERE e.user_id = match_user_id
      AND e.article_id IS NOT NULL
      AND (match_feed_id IS NULL OR a.feed_id = match_feed_id)
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity

    UNION ALL

    -- Repository embeddings
    SELECT
        e.id,
        NULL::uuid AS article_id,
        e.repository_id,
        e.chunk_index,
        e.content,
        1 - (e.embedding <=> query_embedding) AS score,
        'repository'::text AS source_type,
        r.full_name AS source_title,
        r.html_url AS source_url
    FROM all_embeddings e
    JOIN repositories r ON e.repository_id = r.id
    WHERE e.user_id = match_user_id
      AND e.repository_id IS NOT NULL
      AND match_feed_id IS NULL  -- repository 不支持 feed_id 过滤
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity

    ORDER BY score DESC
    LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION search_all_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_all_embeddings TO service_role;

-- ============================================================================
-- 6. 添加注释
-- ============================================================================

COMMENT ON COLUMN all_embeddings.repository_id IS '关联的仓库 ID（与 article_id 互斥）';
COMMENT ON COLUMN repositories.embedding_processed IS 'Embedding 处理状态';
COMMENT ON COLUMN repositories.embedding_processed_at IS 'Embedding 处理时间';
