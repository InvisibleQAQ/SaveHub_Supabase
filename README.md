<p align="center">
  <img src="./docs/images/logo.png" alt="SaveHub Logo" width="120" />
</p>

<h1 align="center">SaveHub</h1>

<p align="center">
  <strong>RSS驱动的开源项目发现与知识管理平台</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Next.js-14-black" alt="Next.js" /></a>
  <a href="#"><img src="https://img.shields.io/badge/FastAPI-0.112+-green" alt="FastAPI" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E" alt="Supabase" /></a>
  <a href="#"><img src="https://img.shields.io/badge/pgvector-RAG-purple" alt="pgvector" /></a>
  <a href="https://github.com/X-lab2017/open-digger"><img src="https://img.shields.io/badge/OpenDigger-集成-orange" alt="OpenDigger" /></a>
</p>

---

> **本项目用于 OpenRank 杯"开源数字生态分析与应用创新赛"**
>
> 已融合项目：[OpenDigger](https://github.com/X-lab2017/open-digger) - 用于开源仓库活跃度与社区健康度分析

---

## 为什么需要 SaveHub？

> 你是否有过这样的经历：在 Twitter/X、Hacker News、Reddit 上刷到一个很酷的开源项目，点了 Star 后就再也没打开过？

**开源来源于日常点点滴滴**。我们每天在社交媒体上刷到无数优秀的开源项目，但往往刷过就忘，或者保存后再也不会看。

SaveHub 解决这个问题：

1. **RSS 自动订阅** - 订阅技术博客、Hacker News、Reddit 等，内容自动入库，省去手动保存的麻烦
2. **AI 智能处理** - 自动翻译、摘要、提取文章中的 GitHub 仓库链接
3. **仓库深度分析** - 集成 OpenDigger 和 GitHub API，分析项目活跃度、社区健康度
4. **语义检索 (RAG)** - 基于向量搜索，用自然语言查询你收藏的知识库

从"被动刷到"到"主动管理"，让每一个值得关注的开源项目都不再被遗忘。

---

## 功能特性

### 核心功能

| 功能 | 描述 | 状态 |
|------|------|------|
| RSS 订阅管理 | 添加/编辑/删除订阅源，文件夹组织，自动刷新 | ✅ |
| 文章阅读 | 阅读/未读标记，星标收藏，键盘快捷键 | ✅ |
| 实时同步 | WebSocket 多设备同步 | ✅ |
| 后台任务 | Celery 异步刷新，智能调度 | ✅ |

### AI 增强功能

| 功能 | 描述 | 状态 |
|------|------|------|
| 文章翻译 | 多语言文章自动翻译 | ✅ |
| 智能摘要 | AI 生成文章摘要 | ✅ |
| 标签提取 | 自动提取文章关键标签 | ✅ |
| 仓库分析 | 分析 GitHub 仓库 README，生成结构化信息 | ✅ |

### RAG 语义搜索

| 功能 | 描述 | 状态 |
|------|------|------|
| 文章向量化 | 多模态 RAG（文本 + 图片描述） | ✅ |
| 语义检索 | pgvector 相似度搜索 | ✅ |

### GitHub 集成

| 功能 | 描述 | 状态 |
|------|------|------|
| Starred 同步 | 一键同步 GitHub starred 仓库 | ✅ |
| README 分析 | AI 分析仓库 README，提取技术栈/用途 | ✅ |
| OpenDigger 分析 | 仓库活跃度、社区健康度分析 | ✅ |

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                │
│  Next.js 14 + React 18 + Zustand + shadcn/ui + TailwindCSS     │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP / WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                          Backend                                │
│  FastAPI + Celery + Redis                                       │
│  ├─ RSS 解析服务                                                │
│  ├─ AI 服务 (OpenAI 兼容 API)                                   │
│  └─ RAG 管道 (chunker → vision → embedder → retriever)         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         Database                                │
│  Supabase (PostgreSQL + pgvector + RLS)                        │
│  ├─ 用户数据隔离 (Row Level Security)                          │
│  ├─ 向量索引 (HNSW)                                            │
│  └─ 全文搜索 (pg_trgm)                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14, React 18, TypeScript, Zustand, shadcn/ui, TailwindCSS |
| 后端 | FastAPI, Celery, Redis, Pydantic |
| 数据库 | Supabase (PostgreSQL), pgvector, RLS |
| AI/ML | OpenAI 兼容 API, 向量嵌入, Vision API |
| 部署 | Docker (即将支持) |

---

## 快速开始

### 前置要求

- Node.js >= 18
- Python >= 3.10
- Redis (用于 Celery 任务队列)
- Supabase 账户 (免费版即可)

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/SaveHub.git
cd SaveHub
```

### 2. 配置环境变量

```bash
# 前端配置
cp frontend/.env.example frontend/.env

# 后端配置
cp backend/.env.example backend/.env
```

编辑 `.env` 文件，填入 Supabase 凭证。

### 3. 安装依赖

```bash
# 前端
cd frontend && pnpm install

# 后端
cd ../backend && pip install -r requirements.txt
```

### 4. 初始化数据库

在 Supabase SQL Editor 中执行 `backend/scripts/` 目录下的 SQL 脚本。

### 5. 启动服务

```bash
# 前端 (localhost:3000)
cd frontend && pnpm dev

# 后端 (localhost:8000)
cd backend && uvicorn app.main:app --reload

# Celery Worker (另开终端)
celery -A app.celery_app worker --loglevel=info --pool=solo
```

访问 http://localhost:3000 开始使用。

---

## 项目结构

```
SaveHub/
├── frontend/              # Next.js 前端
│   ├── app/               # App Router 页面
│   ├── components/        # React 组件
│   └── lib/store/         # Zustand 状态管理
├── backend/               # FastAPI 后端
│   └── app/
│       ├── api/routers/   # API 路由
│       ├── services/      # 业务服务
│       └── celery_app/    # Celery 任务
└── docs/                  # 项目文档
```

---

## API 文档

后端启动后访问 http://localhost:8000/docs 查看 Swagger 文档。

### 主要端点

| 模块 | 端点 | 描述 |
|------|------|------|
| RSS | `POST /api/rss/parse` | 解析 RSS 源 |
| Feeds | `GET/POST /api/feeds` | 订阅源 CRUD |
| Articles | `GET/PATCH /api/articles` | 文章管理 |
| Repositories | `POST /api/repositories/sync` | 同步 GitHub Starred |
| RAG | `POST /api/rag/search` | 语义搜索 |

---

## 贡献指南

欢迎各种形式的贡献！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 路线图

### 近期计划

- [ ] Docker 一键部署支持
- [ ] 知识图谱可视化
- [ ] 对话式知识问答

### 长期愿景

- [ ] 浏览器插件
- [ ] 移动端适配
- [ ] 多用户协作

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

## 致谢

- [OpenDigger](https://github.com/X-lab2017/open-digger) - 开源项目数据分析
- [Supabase](https://supabase.com/) - 开源 Firebase 替代方案
- [shadcn/ui](https://ui.shadcn.com/) - React 组件库

---

<p align="center">
  Made with ❤️ for OpenRank Cup
</p>
