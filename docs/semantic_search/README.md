# 语义化搜索功能实现指南

## 概述

为 RSS 阅读器添加基于 pgvector 的语义化搜索功能，支持用户通过自然语言搜索文章。

## 技术栈

- **向量数据库**: PostgreSQL + pgvector 扩展
- **Embedding API**: OpenAI 兼容接口（支持自定义 base URL）
- **前端**: Next.js 14 App Router + shadcn/ui

## 设计决策

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 配置存储 | api_configs 表添加 embedding_* 字段 | 复用现有表结构，添加前缀区分 |
| 向量存储 | articles 表添加 embedding 列 | 简单直接，避免 JOIN 开销 |
| 生成时机 | 文章添加时自动生成 | 实时索引，无需手动触发 |
| 维度配置 | embedding_dimensions 字段 | 支持不同模型的维度差异 |
| 错误处理 | 保存文章，标记 status='failed' | 不阻塞文章保存，后续可重试 |
| 历史数据 | 提供手动回填按钮 | 用户可选择性回填 |
| 搜索排序 | 纯语义相似度 | 100% 向量余弦相似度 |

## 实现阶段

| 阶段 | 文档 | 说明 |
|------|------|------|
| 1 | [01-database-setup.md](./01-database-setup.md) | 数据库 Schema 变更 |
| 2 | [02-type-definitions.md](./02-type-definitions.md) | TypeScript 类型定义 |
| 3 | [03-embedding-service.md](./03-embedding-service.md) | Embedding 服务实现 |
| 4 | [04-database-layer.md](./04-database-layer.md) | 数据库操作层更新 |
| 5 | [05-store-integration.md](./05-store-integration.md) | Zustand Store 集成 |
| 6 | [06-search-api.md](./06-search-api.md) | 搜索 API 路由 |
| 7 | [07-search-page.md](./07-search-page.md) | 前端搜索页面 |
| 8 | [08-settings-ui.md](./08-settings-ui.md) | 设置界面更新 |
| 9 | [09-sidebar-navigation.md](./09-sidebar-navigation.md) | Sidebar 导航更新 |

## 依赖关系

```
Phase 1 (Database)
    ↓
Phase 2 (Types)
    ↓
Phase 3 (Embedding Service) → Phase 4 (DB Layer)
                                    ↓
                              Phase 5 (Store)
                                    ↓
                     Phase 6 (API) + Phase 7 (Frontend)
                                    ↓
                     Phase 8 (Settings) + Phase 9 (Sidebar)
```

## 文件变更清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `scripts/012_add_semantic_search.sql` | 数据库迁移脚本 |
| `lib/embedding/service.ts` | Embedding 生成服务 |
| `lib/embedding/validation.ts` | Embedding API 验证 |
| `lib/db/search.ts` | 语义搜索数据库操作 |
| `lib/store/search.slice.ts` | 搜索状态管理 |
| `app/api/search/route.ts` | 搜索 API 端点 |
| `app/(reader)/search/page.tsx` | 搜索页面 |
| `components/search-article-list.tsx` | 搜索结果列表组件 |
| `hooks/use-debounce.ts` | Debounce hook |

### 修改文件

| 文件 | 变更 |
|------|------|
| `lib/types.ts` | 添加 embedding 相关类型 |
| `lib/db/api-configs.ts` | 添加 embedding 字段加密/解密 |
| `lib/db/articles.ts` | 添加 embedding 字段处理 |
| `lib/store/articles.slice.ts` | 集成自动 embedding 生成 |
| `lib/store/index.ts` | 集成 SearchSlice |
| `app/(reader)/settings/api/page.tsx` | 添加 Embedding 配置 UI |
| `components/sidebar/expanded-view.tsx` | 添加 Search 导航 |

## 注意事项

1. **pgvector 扩展**: 需要在 Supabase Dashboard → Database → Extensions 中手动启用
2. **向量维度**: SQL 中 `vector(1536)` 是固定的，如需支持其他维度需要更复杂的方案
3. **API 调用成本**: embedding 生成会产生 API 调用费用，批量回填时需注意
4. **索引效率**: IVFFlat 索引需要一定数量的数据（建议 1000+ 条）才能有效
