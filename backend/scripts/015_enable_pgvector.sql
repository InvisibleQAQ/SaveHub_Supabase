-- 015_enable_pgvector.sql
-- 启用 pgvector 和 pg_trgm 扩展
--
-- 前置条件: 需要在 Supabase Dashboard 的 Extensions 页面先启用 vector 扩展
-- 或者使用 Supabase CLI: supabase extensions enable vector
--
-- 依赖: 无
-- 被依赖: 017, 019, 024 (所有使用向量嵌入的表)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 用于模糊搜索
