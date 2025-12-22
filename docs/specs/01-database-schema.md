# 数据库设计文档

> PostgreSQL + pgvector 表结构设计

## 迁移脚本清单

| 序号 | 文件名 | 描述 | 依赖 |
|------|--------|------|------|
| 015 | `015_enable_pgvector.sql` | 启用 pgvector 扩展 | - |
| 016 | `016_create_system_settings.sql` | 系统设置表 | - |
| 017 | `017_create_knowledge_entity.sql` | 知识实体表 | 015 |
| 018 | `018_create_relates_to.sql` | 关系边表 | 017 |
| 019 | `019_create_content_source.sql` | 内容源表 | 015 |
| 020 | `020_create_scratchpad.sql` | 草稿表 | - |
| 021 | `021_create_conversation.sql` | 对话表 | - |
| 022 | `022_create_message.sql` | 消息表 | 021 |
| 023 | `023_create_background_task.sql` | 任务状态表 | - |
| 024 | `024_extend_articles.sql` | 扩展文章表 | 015 |

---

## 表结构详细设计

### 015 - 启用 pgvector 扩展

```sql
-- 015_enable_pgvector.sql
-- 注意: 需要在 Supabase Dashboard 的 Extensions 页面先启用 vector 扩展
-- 或者使用 Supabase CLI: supabase extensions enable vector

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 用于模糊搜索
```

### 016 - 系统设置表

```sql
-- 016_create_system_settings.sql
CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 嵌入模型配置
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dimensions INTEGER NOT NULL DEFAULT 1536,

  -- LLM 配置（使用哪个 api_config）
  default_api_config_id UUID REFERENCES api_configs(id) ON DELETE SET NULL,

  -- 摄取配置
  auto_extract_from_articles BOOLEAN DEFAULT FALSE,  -- RSS 文章自动提取
  chunk_min_chars INTEGER DEFAULT 500,
  chunk_max_chars INTEGER DEFAULT 2000,

  -- 检索配置
  retrieval_vector_weight FLOAT DEFAULT 0.5,
  retrieval_fts_weight FLOAT DEFAULT 0.3,
  retrieval_graph_weight FLOAT DEFAULT 0.2,
  retrieval_top_k INTEGER DEFAULT 10,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每个用户只能有一条设置
CREATE UNIQUE INDEX idx_system_settings_user ON system_settings(user_id);

-- RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings_select" ON system_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "system_settings_insert" ON system_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "system_settings_update" ON system_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_system_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_settings_updated
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 017 - 知识实体表

```sql
-- 017_create_knowledge_entity.sql
CREATE TABLE IF NOT EXISTS knowledge_entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 核心字段
  name TEXT NOT NULL,
  description TEXT,
  entity_type TEXT NOT NULL DEFAULT 'concept',
    -- 支持的类型: concept, person, organization, location, event, project, idea, tool, book

  -- 向量嵌入 (1536维 for OpenAI text-embedding-3-small)
  embedding vector(1536),

  -- 来源追溯
  source_type TEXT,  -- article, content_source, scratchpad, manual
  source_id UUID,    -- 关联的源记录 ID

  -- 元数据
  metadata JSONB DEFAULT '{}',
  -- 示例: {"original_text": "...", "confidence": 0.95, "aliases": ["别名1", "别名2"]}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_knowledge_entity_user ON knowledge_entity(user_id);
CREATE INDEX idx_knowledge_entity_type ON knowledge_entity(entity_type);
CREATE INDEX idx_knowledge_entity_source ON knowledge_entity(source_type, source_id);
CREATE INDEX idx_knowledge_entity_created ON knowledge_entity(created_at DESC);

-- 模糊搜索索引 (pg_trgm)
CREATE INDEX idx_knowledge_entity_name_trgm ON knowledge_entity USING gin(name gin_trgm_ops);
CREATE INDEX idx_knowledge_entity_desc_trgm ON knowledge_entity USING gin(description gin_trgm_ops);

-- HNSW 向量索引 (余弦距离)
CREATE INDEX idx_knowledge_entity_embedding ON knowledge_entity
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 全文搜索索引
ALTER TABLE knowledge_entity ADD COLUMN IF NOT EXISTS fts_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;
CREATE INDEX idx_knowledge_entity_fts ON knowledge_entity USING gin(fts_vector);

-- RLS
ALTER TABLE knowledge_entity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_entity_select" ON knowledge_entity
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "knowledge_entity_insert" ON knowledge_entity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "knowledge_entity_update" ON knowledge_entity
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "knowledge_entity_delete" ON knowledge_entity
  FOR DELETE USING (auth.uid() = user_id);

-- 触发器
CREATE TRIGGER knowledge_entity_updated
  BEFORE UPDATE ON knowledge_entity
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 018 - 关系边表

```sql
-- 018_create_relates_to.sql
CREATE TABLE IF NOT EXISTS relates_to (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 关系端点
  source_entity_id UUID NOT NULL REFERENCES knowledge_entity(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES knowledge_entity(id) ON DELETE CASCADE,

  -- 关系类型
  relation_type TEXT NOT NULL DEFAULT 'related_to',
    -- 支持的类型: related_to, part_of, instance_of, causes, precedes, contradicts, supports

  -- 关系强度 (0.0 - 1.0)
  weight FLOAT DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),

  -- 元数据
  metadata JSONB DEFAULT '{}',
  -- 示例: {"confidence": 0.9, "source": "llm_extraction", "context": "..."}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 约束：防止自环
  CONSTRAINT no_self_loop CHECK (source_entity_id != target_entity_id)
);

-- 索引
CREATE INDEX idx_relates_to_user ON relates_to(user_id);
CREATE INDEX idx_relates_to_source ON relates_to(source_entity_id);
CREATE INDEX idx_relates_to_target ON relates_to(target_entity_id);
CREATE INDEX idx_relates_to_type ON relates_to(relation_type);

-- 唯一约束：同类型关系不重复
CREATE UNIQUE INDEX idx_relates_to_unique
  ON relates_to(source_entity_id, target_entity_id, relation_type);

-- RLS
ALTER TABLE relates_to ENABLE ROW LEVEL SECURITY;

CREATE POLICY "relates_to_select" ON relates_to
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "relates_to_insert" ON relates_to
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "relates_to_update" ON relates_to
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "relates_to_delete" ON relates_to
  FOR DELETE USING (auth.uid() = user_id);
```

### 019 - 内容源表

```sql
-- 019_create_content_source.sql
CREATE TABLE IF NOT EXISTS content_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 源类型
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'pdf', 'audio', 'image', 'text')),

  -- 基本信息
  title TEXT NOT NULL,
  url TEXT,                    -- URL 类型必填
  file_path TEXT,              -- Supabase Storage 路径
  file_name TEXT,              -- 原始文件名
  mime_type TEXT,              -- MIME 类型
  file_size INTEGER,           -- 文件大小 (bytes)

  -- 提取的内容
  content TEXT,                -- 提取的文本内容
  summary TEXT,                -- 自动摘要

  -- 向量嵌入
  embedding vector(1536),

  -- 元数据
  metadata JSONB DEFAULT '{}',
  -- 示例: {"author": "...", "publish_date": "...", "word_count": 1234}

  -- 处理状态
  processing_status TEXT DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error TEXT,
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_content_source_user ON content_source(user_id);
CREATE INDEX idx_content_source_type ON content_source(source_type);
CREATE INDEX idx_content_source_status ON content_source(processing_status);
CREATE INDEX idx_content_source_created ON content_source(created_at DESC);

-- HNSW 向量索引
CREATE INDEX idx_content_source_embedding ON content_source
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 全文搜索
ALTER TABLE content_source ADD COLUMN IF NOT EXISTS fts_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;
CREATE INDEX idx_content_source_fts ON content_source USING gin(fts_vector);

-- RLS
ALTER TABLE content_source ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_source_all" ON content_source
  FOR ALL USING (auth.uid() = user_id);

-- 触发器
CREATE TRIGGER content_source_updated
  BEFORE UPDATE ON content_source
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 020 - 草稿表

```sql
-- 020_create_scratchpad.sql
CREATE TABLE IF NOT EXISTS scratchpad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 内容
  content TEXT NOT NULL,

  -- 状态
  is_archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMPTZ,

  -- 摄取追踪
  is_ingested BOOLEAN DEFAULT FALSE,
  ingested_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_scratchpad_user ON scratchpad(user_id);
CREATE INDEX idx_scratchpad_archived ON scratchpad(is_archived);
CREATE INDEX idx_scratchpad_updated ON scratchpad(updated_at DESC);

-- RLS
ALTER TABLE scratchpad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scratchpad_all" ON scratchpad
  FOR ALL USING (auth.uid() = user_id);

-- 触发器
CREATE TRIGGER scratchpad_updated
  BEFORE UPDATE ON scratchpad
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 021 - 对话表

```sql
-- 021_create_conversation.sql
CREATE TABLE IF NOT EXISTS conversation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 基本信息
  title TEXT DEFAULT 'New Conversation',

  -- 关联的上下文实体（可选）
  context_entity_ids UUID[] DEFAULT '{}',

  -- 元数据
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_conversation_user ON conversation(user_id);
CREATE INDEX idx_conversation_updated ON conversation(updated_at DESC);

-- RLS
ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_all" ON conversation
  FOR ALL USING (auth.uid() = user_id);

-- 触发器
CREATE TRIGGER conversation_updated
  BEFORE UPDATE ON conversation
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 022 - 消息表

```sql
-- 022_create_message.sql
CREATE TABLE IF NOT EXISTS message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,

  -- 角色
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),

  -- 内容
  content TEXT NOT NULL,

  -- 引用追溯 (assistant 消息)
  references JSONB DEFAULT '[]',
  -- 结构: [{"entity_id": "...", "entity_name": "...", "snippet": "...", "score": 0.95}]

  -- 元数据
  metadata JSONB DEFAULT '{}',
  -- 示例: {"model": "gpt-4o-mini", "tokens_used": 123}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_message_conversation ON message(conversation_id);
CREATE INDEX idx_message_created ON message(created_at);

-- 注意：不需要 RLS，通过 conversation 外键级联控制访问
```

### 023 - 后台任务状态表

```sql
-- 023_create_background_task.sql
CREATE TABLE IF NOT EXISTS background_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 任务类型
  task_type TEXT NOT NULL,
    -- 支持: ingest_url, ingest_pdf, ingest_audio, ingest_image, ingest_text,
    --       extract_entities, generate_embedding, batch_embed

  -- 目标
  target_type TEXT,  -- content_source, article, scratchpad, knowledge_entity
  target_id UUID,

  -- 状态
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reserved', 'processing', 'succeeded', 'failed')),

  -- Celery 关联
  celery_task_id TEXT,

  -- 进度
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),

  -- 结果
  result JSONB,
  error TEXT,

  -- 重试
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_background_task_user ON background_task(user_id);
CREATE INDEX idx_background_task_status ON background_task(status);
CREATE INDEX idx_background_task_type ON background_task(task_type);
CREATE INDEX idx_background_task_celery ON background_task(celery_task_id);
CREATE INDEX idx_background_task_pending ON background_task(status, next_retry_at)
  WHERE status = 'pending';

-- RLS
ALTER TABLE background_task ENABLE ROW LEVEL SECURITY;

CREATE POLICY "background_task_select" ON background_task
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "background_task_insert" ON background_task
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "background_task_update" ON background_task
  FOR UPDATE USING (auth.uid() = user_id);

-- 触发器
CREATE TRIGGER background_task_updated
  BEFORE UPDATE ON background_task
  FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
```

### 024 - 扩展文章表

```sql
-- 024_extend_articles.sql
-- 为现有 articles 表添加知识图谱支持

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS entities_extracted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS extraction_task_id UUID REFERENCES background_task(id),
ADD COLUMN IF NOT EXISTS extraction_error TEXT;

-- HNSW 向量索引 (仅对有嵌入的文章)
CREATE INDEX IF NOT EXISTS idx_articles_embedding ON articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- 待提取文章索引
CREATE INDEX IF NOT EXISTS idx_articles_pending_extraction ON articles(entities_extracted, created_at)
  WHERE entities_extracted = FALSE;
```

---

## 表关系 ER 图

```
┌──────────────────┐     ┌──────────────────┐
│   auth.users     │     │  system_settings │
│ (Supabase内置)   │◄────┤  user_id         │
└────────┬─────────┘     └──────────────────┘
         │
         │ user_id (所有表)
         │
    ┌────┴────┬────────────┬─────────────┬─────────────┐
    │         │            │             │             │
    ▼         ▼            ▼             ▼             ▼
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│knowledge│ │content_ │ │scratchpad│ │conversa- │ │background│
│_entity  │ │source   │ │          │ │tion      │ │_task     │
└────┬────┘ └─────────┘ └──────────┘ └────┬─────┘ └──────────┘
     │                                     │
     │ source_entity_id                    │ conversation_id
     │ target_entity_id                    │
     ▼                                     ▼
┌─────────┐                          ┌──────────┐
│relates_ │                          │ message  │
│to       │                          │          │
└─────────┘                          └──────────┘

┌──────────────────────────────────────────────────────────┐
│                     articles (扩展)                       │
│  + embedding vector(1536)                                │
│  + entities_extracted boolean                            │
└──────────────────────────────────────────────────────────┘
```

---

## RLS 策略汇总

所有新表都遵循相同的 RLS 模式：

```sql
-- 标准 RLS 策略模板
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "{table_name}_select" ON {table_name}
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "{table_name}_insert" ON {table_name}
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "{table_name}_update" ON {table_name}
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "{table_name}_delete" ON {table_name}
  FOR DELETE USING (auth.uid() = user_id);
```

**例外**：
- `message` 表通过 `conversation` 外键级联控制，不需要独立 RLS

---

## 索引策略

### 向量索引 (HNSW)
- `m = 16`: 每个节点的最大连接数
- `ef_construction = 64`: 构建时的搜索宽度
- `vector_cosine_ops`: 余弦距离（最常用）

### 全文搜索索引
- 使用 `tsvector` 生成列 + `gin` 索引
- 权重分配：标题 `A`，内容 `B`

### 模糊搜索索引
- 使用 `pg_trgm` 的 `gin_trgm_ops`
- 支持 `ILIKE '%keyword%'` 和相似度搜索

---

## 下一步

继续阅读 `02-knowledge-graph.md` 了解知识图谱功能的详细规格。
