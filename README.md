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

### 核心优势

#### 1. 自动收集 - 基于庞大的 RSS 生态

相比传统知识库需要手动添加内容，SaveHub 基于 **RSS 生态系统自动收集**：

- 支持自建 [RSSHub](https://github.com/DIYgod/RSSHub)（⭐ 40k+），可订阅几乎任何网站
- 订阅技术博客、Hacker News、Reddit、Twitter 等，内容自动入库
- **零手动操作**，让知识自动流入你的个人知识库

#### 2. Self-RAG 智能问答 - 显著减少"幻觉"

采用 **Self-RAG（自我反思检索增强生成）** 技术，相比传统 RAG：

- **按需检索**：模型自主判断是否需要检索，避免无效检索干扰
- **自我纠错**：通过反思机制验证生成内容的准确性
- **显著减少幻觉**：大幅提升答案的精准度与可信度
- **引用溯源**：每个回答都标注来源，支持一键跳转原文

#### 3. 专为开源项目优化的知识库

- **AI 智能解析**：自动识别并提取文章中的 GitHub 仓库链接
- **仓库深度分析**：集成 OpenDigger，分析项目活跃度、社区健康度
- **开源项目聚焦**：围绕开源生态构建的垂直知识库

<p align="center">
  <img src="https://typora-makedown-picture.oss-cn-shanghai.aliyuncs.com/img/2022/RAG问答截图.png" alt="Self-RAG 智能问答示例" width="800" />
  <br/>
  <em>Self-RAG 智能问答：带引用标记的精准回答</em>
</p>

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
| 对话式问答 | 基于 RAG 的知识库对话问答 | ✅ |

### GitHub 集成

| 功能 | 描述 | 状态 |
|------|------|------|
| Starred 同步 | 一键同步 GitHub starred 仓库 | ✅ |
| README 分析 | AI 分析仓库 README，提取技术栈/用途 | ✅ |
| OpenDigger 分析 | 仓库活跃度、社区健康度分析 | ✅ |

---

## 界面预览

<p align="center">
  <img src="https://typora-makedown-picture.oss-cn-shanghai.aliyuncs.com/img/2022/article_view.png" alt="文章阅读视图" width="800" />
  <br/>
  <em>文章阅读视图：沉浸式阅读体验，支持翻译、摘要、标签等 AI 功能</em>
</p>

<p align="center">
  <img src="https://typora-makedown-picture.oss-cn-shanghai.aliyuncs.com/img/2022/RepositoryGallery.png" alt="仓库画廊" width="800" />
  <br/>
  <em>仓库画廊：可视化管理收藏的 GitHub 仓库，集成 OpenDigger 分析</em>
</p>

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
- [ ] **视频解析** - 支持从视频中提取开源项目信息

### 长期愿景

- [ ] 浏览器插件
- [ ] 移动端适配
- [ ] **[RepoMaster](https://github.com/QuantaAlpha/RepoMaster) 集成** - 自主理解并利用现有 GitHub 代码库解决复杂任务，让海量开源项目直接为用户所用
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
