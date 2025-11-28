# Phase 1: 数据库 Schema 变更

## 概述

本阶段完成 pgvector 扩展启用和数据库表结构变更。

## 前置条件

- Supabase 项目已创建
- 有权限访问 Supabase Dashboard

## 步骤 1: 启用 pgvector 扩展

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 步骤 2: 创建迁移脚本

**新建文件**: `scripts/012_add_semantic_search.sql`

```sql
-- ============================================
-- RSS Reader 语义化搜索功能数据库迁移
-- ============================================

-- 1. 确保 pgvector 扩展已启用
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 2. api_configs 表添加 embedding 配置字段
-- ============================================

-- Embedding API Key（加密存储）
ALTER TABLE api_configs
ADD COLUMN IF NOT EXISTS embedding_api_key TEXT;

-- Embedding API Base URL（加密存储）
ALTER TABLE api_configs
ADD COLUMN IF NOT EXISTS embedding_api_base TEXT;

-- Embedding 模型名称
ALTER TABLE api_configs
ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- 向量维度（不同模型维度不同）
ALTER TABLE api_configs
ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER DEFAULT 1536;

-- ============================================
-- 3. articles 表添加 embedding 字段
-- ============================================

-- 向量列（使用 1536 维度，兼容 OpenAI text-embedding-3-small）
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- embedding 状态：pending | completed | failed | skipped
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'pending';

-- ============================================
-- 4. 创建向量相似度搜索索引
-- ============================================

-- IVFFlat 索引（适合中等规模数据，lists 参数建议为 sqrt(row_count)）
-- 注意：索引创建需要表中有足够数据，否则可能报错
-- 可以在数据量达到 1000+ 条后再创建索引

-- DROP INDEX IF EXISTS idx_articles_embedding;
CREATE INDEX IF NOT EXISTS idx_articles_embedding
ON articles USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- embedding_status 索引（用于查询待处理/失败的文章）
CREATE INDEX IF NOT EXISTS idx_articles_embedding_status
ON articles (embedding_status)
WHERE embedding_status IN ('pending', 'failed');

-- ============================================
-- 5. 创建语义搜索函数
-- ============================================

CREATE OR REPLACE FUNCTION search_articles_semantic(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  feed_id uuid,
  title text,
  content text,
  summary text,
  url text,
  author text,
  published_at timestamptz,
  is_read boolean,
  is_starred boolean,
  thumbnail text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.feed_id,
    a.title,
    a.content,
    a.summary,
    a.url,
    a.author,
    a.published_at,
    a.is_read,
    a.is_starred,
    a.thumbnail,
    (1 - (a.embedding <=> query_embedding))::float as similarity
  FROM articles a
  WHERE a.user_id = p_user_id
    AND a.embedding IS NOT NULL
    AND (1 - (a.embedding <=> query_embedding)) > match_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION search_articles_semantic TO authenticated;

-- ============================================
-- 6. 创建批量更新 embedding 的辅助函数（可选）
-- ============================================

CREATE OR REPLACE FUNCTION update_article_embedding(
  p_article_id uuid,
  p_embedding vector(1536),
  p_status text DEFAULT 'completed'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE articles
  SET
    embedding = p_embedding,
    embedding_status = p_status
  WHERE id = p_article_id
    AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION update_article_embedding TO authenticated;
```

## 步骤 3: 执行迁移

1. 打开 Supabase Dashboard → **SQL Editor**
2. 复制上述 SQL 脚本
3. 点击 **Run** 执行

## 验证

执行以下查询验证变更：

```sql
-- 检查 api_configs 表新字段
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'api_configs'
  AND column_name LIKE 'embedding%';

-- 检查 articles 表新字段
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'articles'
  AND column_name IN ('embedding', 'embedding_status');

-- 检查函数是否创建成功
SELECT routine_name
FROM information_schema.routines
WHERE routine_name IN ('search_articles_semantic', 'update_article_embedding');
```

## 预期结果

- `api_configs` 表新增 4 个字段：`embedding_api_key`, `embedding_api_base`, `embedding_model`, `embedding_dimensions`
- `articles` 表新增 2 个字段：`embedding` (vector), `embedding_status` (text)
- 创建 2 个函数：`search_articles_semantic`, `update_article_embedding`
- 创建 2 个索引：`idx_articles_embedding`, `idx_articles_embedding_status`

## 注意事项

1. **向量维度固定**: `vector(1536)` 是硬编码的。如果使用不同维度的模型，需要修改 SQL 或使用动态方案
2. **索引创建时机**: IVFFlat 索引在数据量少时可能报错，建议数据量达到 100+ 条后再创建
3. **RLS 策略**: 现有的 `articles_user_isolation` RLS 策略会自动应用到新字段

## 下一步

完成数据库变更后，继续 [Phase 2: 类型定义更新](./02-type-definitions.md)
