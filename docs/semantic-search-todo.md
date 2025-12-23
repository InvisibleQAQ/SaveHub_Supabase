# SaveHub 语义搜索功能 - 任务清单

> 参考 minne 项目实现，使用 pgvector 为文章提供语义搜索功能

## 设计决策

| 项目           | 选择               | 说明                                                                         |
| -------------- | ------------------ | ---------------------------------------------------------------------------- |
| Embedding 配置 | `api_configs` 表 | 独立字段：`embedding_api_key`, `embedding_api_base`, `embedding_model` |
| 嵌入策略       | 内容分块多向量     | article_chunks 表                                                            |
| Phase 1 范围   | 纯向量搜索         | 不含 BM25 融合                                                               |

---

## Phase 1: 核心向量搜索

### 1. 数据库迁移

- [X] **扩展 `api_configs` 表（添加 embedding 配置字段）**

  - 文件：`backend/scripts/016_add_embedding_config.sql`
  - 添加 `embedding_api_key text` - Embedding API 密钥
  - 添加 `embedding_api_base text` - Embedding API 地址
  - 添加 `embedding_model text` - Embedding 模型名称
- [ ] **创建 `017_add_article_chunks.sql`**

  - 文件：`backend/scripts/017_add_article_chunks.sql`
  - 为 articles 表添加 embedding 状态字段
  - 创建 article_chunks 表（id, article_id, user_id, chunk_index, content, embedding）
  - 创建 HNSW 向量索引
- [ ] **创建 `018_vector_search_function.sql`**

  - 文件：`backend/scripts/018_vector_search_function.sql`
  - 实现 `vector_search_articles` SQL 函数
  - 支持余弦相似度查询
- [ ] **在 Supabase 执行迁移**

  - 确保 015_enable_pgvector.sql 已执行
  - 按顺序执行 016, 017, 018 脚本

### 2. 后端服务实现

- [ ] **更新依赖**

  - 文件：`backend/requirements.txt`
  - 添加 `openai>=1.0.0`
- [ ] **创建分块服务 `chunking.py`**

  - 文件：`backend/app/services/chunking.py`
  - 实现 `ChunkingService` 类
  - 分块参数：min=500, max=2000 字符
  - 按句号/段落边界分割
- [ ] **创建 Embedding 服务 `embedding.py`**

  - 文件：`backend/app/services/embedding.py`
  - 实现 `EmbeddingService` 类
  - 从 `api_configs` 表读取 `embedding_api_key`, `embedding_api_base`, `embedding_model`
  - 配置缺失时抛出明确错误提示
  - 支持单文本和批量 embedding
- [ ] **创建搜索服务 `search.py`**

  - 文件：`backend/app/services/search.py`
  - 实现 `SearchService` 类
  - 向量搜索 + 结果聚合

### 3. API 端点实现

- [ ] **创建搜索 Schema**

  - 文件：`backend/app/schemas/search.py`
  - SearchRequest, SearchResponse, ArticleSearchResult
- [ ] **创建搜索 Router**

  - 文件：`backend/app/api/routers/search.py`
  - POST `/api/search/articles` 端点
- [ ] **注册路由**

  - 文件：`backend/app/main.py`
  - 添加 `app.include_router(search.router, prefix="/api/search")`

### 4. Celery 后台任务

- [ ] **创建 Embedding 任务**

  - 文件：`backend/app/celery_app/embedding_tasks.py`
  - `generate_article_embedding` - 单篇文章
  - `batch_generate_embeddings` - 批量处理
  - `trigger_embedding_on_article_save` - 触发器
- [ ] **注册任务模块**

  - 文件：`backend/app/celery_app/celery.py`
  - 添加 `"app.celery_app.embedding_tasks"` 到 include
- [ ] **集成到 RSS 刷新流程**

  - 文件：`backend/app/celery_app/tasks.py`
  - 在文章保存后触发 embedding 任务

### 5. 测试验证

- [ ] 手动测试 embedding 生成
- [ ] 手动测试搜索 API
- [ ] 验证 Celery 任务执行

---

## Phase 2: 混合搜索（后续）

- [ ] 添加 BM25 全文索引
- [ ] 实现 fulltext_search_articles 函数
- [ ] 扩展 SearchService 支持分数融合
- [ ] 添加搜索选项参数

---

## Phase 3: 重排序（可选）

- [ ] 集成 Cross-Encoder 重排序
- [ ] 添加 rerank API 选项
- [ ] A/B 测试评估

---

## 文件清单汇总

### 新增文件

| 文件                                               | 说明                                      |
| -------------------------------------------------- | ----------------------------------------- |
| `backend/scripts/016_add_embedding_config.sql`   | api_configs 表扩展（embedding 配置字段）  |
| `backend/scripts/017_add_article_chunks.sql`     | article_chunks 表迁移                     |
| `backend/scripts/018_vector_search_function.sql` | 向量搜索函数                              |
| `backend/app/services/chunking.py`               | 文本分块服务                              |
| `backend/app/services/embedding.py`              | Embedding 服务（读取 api_configs 表配置） |
| `backend/app/services/search.py`                 | 搜索服务                                  |
| `backend/app/schemas/search.py`                  | 搜索 Schema                               |
| `backend/app/api/routers/search.py`              | 搜索 API                                  |
| `backend/app/celery_app/embedding_tasks.py`      | Celery 任务                               |

### 修改文件

| 文件                                 | 修改                 |
| ------------------------------------ | -------------------- |
| `backend/requirements.txt`         | 添加 openai 依赖     |
| `backend/app/main.py`              | 注册 search router   |
| `backend/app/celery_app/celery.py` | 注册 embedding_tasks |
| `backend/app/celery_app/tasks.py`  | 集成 embedding 触发  |
