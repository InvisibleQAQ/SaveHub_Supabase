-- 020_create_article_embeddings.sql
-- 创建 article_embeddings 表用于存储文章的向量嵌入
--
-- 前置条件: 015_enable_pgvector.sql (启用 vector 扩展)
-- 依赖: articles 表
--
-- 设计说明:
-- - 图片 caption 会替换到原位置融入文本，然后一起语义分块
-- - 所有 chunks 都是纯文本（含图片描述）
-- - chunk_index 保持原文顺序
-- - 使用 IVFFlat 索引加速向量搜索

-- ============================================================================
-- 1. 添加 articles 表的 RAG 处理状态字段
-- ============================================================================

ALTER TABLE articles ADD COLUMN IF NOT EXISTS rag_processed BOOLEAN;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS rag_processed_at TIMESTAMPTZ;

-- 创建部分索引：仅索引待处理的文章
CREATE INDEX IF NOT EXISTS idx_articles_rag_unprocessed
  ON articles (created_at DESC)
  WHERE rag_processed IS NULL AND images_processed = true;

-- ============================================================================
-- 2. 创建 article_embeddings 表
-- ============================================================================

CREATE TABLE IF NOT EXISTS article_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL,
  user_id UUID NOT NULL,

  -- 内容信息
  chunk_index INT NOT NULL,           -- 在文章中的顺序（0-based）
  content TEXT NOT NULL,              -- 文本内容（含图片描述）
  embedding VECTOR(1536) NOT NULL,    -- 1536 维向量 (OpenAI text-embedding-3-small)

  -- 元数据
  metadata JSONB,                     -- 扩展信息（如 token 数等）
  created_at TIMESTAMPTZ DEFAULT now(),

  -- 约束
  CONSTRAINT fk_article FOREIGN KEY (article_id)
    REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ============================================================================
-- 3. 创建索引
-- ============================================================================

-- 按文章查询
CREATE INDEX IF NOT EXISTS idx_embeddings_article
  ON article_embeddings(article_id);

-- 按用户查询
CREATE INDEX IF NOT EXISTS idx_embeddings_user
  ON article_embeddings(user_id);

-- 按用户+文章联合查询
CREATE INDEX IF NOT EXISTS idx_embeddings_user_article
  ON article_embeddings(user_id, article_id);

-- pgvector 向量索引 (IVFFlat + 余弦距离)
-- lists=100 适合中小规模数据集，可根据数据量调整
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
  ON article_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- 4. 启用 RLS (Row Level Security)
-- ============================================================================

ALTER TABLE article_embeddings ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的 embeddings
DROP POLICY IF EXISTS "Users can view own embeddings" ON article_embeddings;
CREATE POLICY "Users can view own embeddings"
  ON article_embeddings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role 拥有完全访问权限（用于后台任务）
DROP POLICY IF EXISTS "Service role full access" ON article_embeddings;
CREATE POLICY "Service role full access"
  ON article_embeddings
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 5. 添加注释
-- ============================================================================

COMMENT ON TABLE article_embeddings IS 'RAG 向量嵌入存储：文章语义分块（图片描述已融入文本）';
COMMENT ON COLUMN article_embeddings.chunk_index IS '在原文中的顺序，0-based';
COMMENT ON COLUMN article_embeddings.content IS '文本内容（含图片描述，格式为 [图片描述: ...]）';
COMMENT ON COLUMN article_embeddings.embedding IS '1536 维向量嵌入 (OpenAI text-embedding-3-small 兼容)';
COMMENT ON COLUMN article_embeddings.metadata IS '扩展元数据 JSON';
