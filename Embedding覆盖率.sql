-- 038_diagnose_all_embeddings_missing_reasons.sql
-- 目的：定位 all_embeddings 未覆盖 articles / repositories 的可能原因
--
-- 输出包含：
-- 1) 覆盖率总览
-- 2) articles 缺失原因统计 + 明细
-- 3) repositories 缺失原因统计 + 明细

-- =====================================================
-- 1) 覆盖率总览
-- =====================================================
WITH article_total AS (
  SELECT COUNT(*) AS total_count
  FROM articles
),
article_covered AS (
  SELECT COUNT(DISTINCT e.article_id) AS covered_count
  FROM all_embeddings e
  WHERE e.article_id IS NOT NULL
),
repo_total AS (
  SELECT COUNT(*) AS total_count
  FROM repositories
),
repo_covered AS (
  SELECT COUNT(DISTINCT e.repository_id) AS covered_count
  FROM all_embeddings e
  WHERE e.repository_id IS NOT NULL
)
SELECT
  'articles' AS target_table,
  at.total_count AS total_ids,
  ac.covered_count AS covered_ids,
  at.total_count - ac.covered_count AS missing_ids,
  ROUND(ac.covered_count::numeric / NULLIF(at.total_count, 0) * 100, 2) AS coverage_pct
FROM article_total at
CROSS JOIN article_covered ac

UNION ALL

SELECT
  'repositories' AS target_table,
  rt.total_count AS total_ids,
  rc.covered_count AS covered_ids,
  rt.total_count - rc.covered_count AS missing_ids,
  ROUND(rc.covered_count::numeric / NULLIF(rt.total_count, 0) * 100, 2) AS coverage_pct
FROM repo_total rt
CROSS JOIN repo_covered rc;


-- =====================================================
-- 2) articles 缺失原因（统计）
-- =====================================================
WITH article_status AS (
  SELECT
    a.id,
    a.user_id,
    a.images_processed,
    a.rag_processed,
    a.rag_processed_at,
    a.created_at,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.article_id = a.id
    ) AS has_embedding
  FROM articles a
),
article_missing AS (
  SELECT
    id,
    user_id,
    images_processed,
    rag_processed,
    rag_processed_at,
    created_at,
    CASE
      WHEN images_processed IS DISTINCT FROM TRUE THEN 'A1_images_not_processed'
      WHEN rag_processed = FALSE THEN 'A2_rag_failed_not_retried'
      WHEN rag_processed IS NULL THEN 'A3_rag_pending_not_run_yet'
      WHEN rag_processed = TRUE THEN 'A4_rag_marked_success_but_no_embedding'
      ELSE 'A9_unknown'
    END AS reason
  FROM article_status
  WHERE has_embedding = FALSE
)
SELECT
  reason,
  COUNT(*) AS missing_count
FROM article_missing
GROUP BY reason
ORDER BY missing_count DESC, reason;


-- =====================================================
-- 3) articles 缺失原因（按用户聚合）
-- =====================================================
WITH article_status AS (
  SELECT
    a.id,
    a.user_id,
    a.images_processed,
    a.rag_processed,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.article_id = a.id
    ) AS has_embedding
  FROM articles a
),
article_missing AS (
  SELECT
    user_id,
    CASE
      WHEN images_processed IS DISTINCT FROM TRUE THEN 'A1_images_not_processed'
      WHEN rag_processed = FALSE THEN 'A2_rag_failed_not_retried'
      WHEN rag_processed IS NULL THEN 'A3_rag_pending_not_run_yet'
      WHEN rag_processed = TRUE THEN 'A4_rag_marked_success_but_no_embedding'
      ELSE 'A9_unknown'
    END AS reason
  FROM article_status
  WHERE has_embedding = FALSE
)
SELECT
  user_id,
  reason,
  COUNT(*) AS missing_count
FROM article_missing
GROUP BY user_id, reason
ORDER BY missing_count DESC, user_id, reason;


-- =====================================================
-- 4) articles 缺失明细
-- =====================================================
WITH article_status AS (
  SELECT
    a.id,
    a.user_id,
    a.images_processed,
    a.rag_processed,
    a.rag_processed_at,
    a.created_at,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.article_id = a.id
    ) AS has_embedding
  FROM articles a
)
SELECT
  a.id AS article_id,
  a.user_id,
  CASE
    WHEN a.images_processed IS DISTINCT FROM TRUE THEN 'A1_images_not_processed'
    WHEN a.rag_processed = FALSE THEN 'A2_rag_failed_not_retried'
    WHEN a.rag_processed IS NULL THEN 'A3_rag_pending_not_run_yet'
    WHEN a.rag_processed = TRUE THEN 'A4_rag_marked_success_but_no_embedding'
    ELSE 'A9_unknown'
  END AS reason,
  a.images_processed,
  a.rag_processed,
  a.rag_processed_at,
  a.created_at
FROM article_status a
WHERE a.has_embedding = FALSE
ORDER BY reason, a.created_at DESC, a.id;


-- =====================================================
-- 5) repositories 缺失原因（统计）
-- =====================================================
WITH repo_status AS (
  SELECT
    r.id,
    r.user_id,
    r.readme_content,
    r.embedding_processed,
    r.embedding_processed_at,
    r.created_at,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.repository_id = r.id
    ) AS has_embedding
  FROM repositories r
),
repo_missing AS (
  SELECT
    id,
    user_id,
    readme_content,
    embedding_processed,
    embedding_processed_at,
    created_at,
    CASE
      WHEN COALESCE(BTRIM(readme_content), '') = '' THEN 'R1_readme_missing_or_empty'
      WHEN embedding_processed = FALSE THEN 'R2_embedding_failed_not_retried'
      WHEN embedding_processed IS NULL THEN 'R3_embedding_pending_not_run_yet'
      WHEN embedding_processed = TRUE THEN 'R4_marked_success_but_no_embedding'
      ELSE 'R9_unknown'
    END AS reason
  FROM repo_status
  WHERE has_embedding = FALSE
)
SELECT
  reason,
  COUNT(*) AS missing_count
FROM repo_missing
GROUP BY reason
ORDER BY missing_count DESC, reason;


-- =====================================================
-- 6) repositories 缺失原因（按用户聚合）
-- =====================================================
WITH repo_status AS (
  SELECT
    r.id,
    r.user_id,
    r.readme_content,
    r.embedding_processed,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.repository_id = r.id
    ) AS has_embedding
  FROM repositories r
),
repo_missing AS (
  SELECT
    user_id,
    CASE
      WHEN COALESCE(BTRIM(readme_content), '') = '' THEN 'R1_readme_missing_or_empty'
      WHEN embedding_processed = FALSE THEN 'R2_embedding_failed_not_retried'
      WHEN embedding_processed IS NULL THEN 'R3_embedding_pending_not_run_yet'
      WHEN embedding_processed = TRUE THEN 'R4_marked_success_but_no_embedding'
      ELSE 'R9_unknown'
    END AS reason
  FROM repo_status
  WHERE has_embedding = FALSE
)
SELECT
  user_id,
  reason,
  COUNT(*) AS missing_count
FROM repo_missing
GROUP BY user_id, reason
ORDER BY missing_count DESC, user_id, reason;


-- =====================================================
-- 7) repositories 缺失明细
-- =====================================================
WITH repo_status AS (
  SELECT
    r.id,
    r.user_id,
    r.full_name,
    r.readme_content,
    r.embedding_processed,
    r.embedding_processed_at,
    r.created_at,
    EXISTS (
      SELECT 1
      FROM all_embeddings e
      WHERE e.repository_id = r.id
    ) AS has_embedding
  FROM repositories r
)
SELECT
  r.id AS repository_id,
  r.user_id,
  r.full_name,
  CASE
    WHEN COALESCE(BTRIM(r.readme_content), '') = '' THEN 'R1_readme_missing_or_empty'
    WHEN r.embedding_processed = FALSE THEN 'R2_embedding_failed_not_retried'
    WHEN r.embedding_processed IS NULL THEN 'R3_embedding_pending_not_run_yet'
    WHEN r.embedding_processed = TRUE THEN 'R4_marked_success_but_no_embedding'
    ELSE 'R9_unknown'
  END AS reason,
  (COALESCE(BTRIM(r.readme_content), '') <> '') AS has_readme,
  r.embedding_processed,
  r.embedding_processed_at,
  r.created_at
FROM repo_status r
WHERE r.has_embedding = FALSE
ORDER BY reason, r.created_at DESC, r.id;
