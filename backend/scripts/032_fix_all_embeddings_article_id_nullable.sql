-- 032_fix_all_embeddings_article_id_nullable.sql
-- 修复 all_embeddings 表的 article_id 列，移除 NOT NULL 约束
--
-- 问题：article_id 和 repository_id 互斥，但 article_id 有 NOT NULL 约束
-- 解决：移除 article_id 的 NOT NULL 约束

-- ============================================================================
-- 1. 移除 article_id 的 NOT NULL 约束
-- ============================================================================

ALTER TABLE all_embeddings
ALTER COLUMN article_id DROP NOT NULL;

-- ============================================================================
-- 2. 添加注释说明
-- ============================================================================

COMMENT ON COLUMN all_embeddings.article_id IS '关联的文章 ID（与 repository_id 互斥，可为空）';
