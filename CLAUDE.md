# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cardinal Rule: Docs as Code

> "Changed the code but not the docs? Then the docs are lies. Lies are worse than no docs at all."

- **When modifying code in a directory, update that directory's CLAUDE.md** — create one if it doesn't exist
- **Don't be stupid**: Frontend style tweaks or non-architectural changes don't need doc updates
- **CLAUDE.md should read like kernel comments**: Precise, short, pointing to code locations — not copying code
- **Pasting large code blocks into docs?** You're writing a blog post, not doing engineering

## Project Overview

SaveHub is a **knowledge management platform** with a monorepo architecture, combining:
- **RSS Reader**: Subscribe, read, and organize RSS feeds
- **Repository Browser**: GitHub repository tracking and analysis
- **AI Chat**: RAG-powered conversational interface for saved content
- **Vector Search**: Semantic search across articles and repositories

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14 + React 18 + Zustand + shadcn/ui |
| **Backend** | FastAPI + Celery + Redis |
| **Database** | Supabase (PostgreSQL + pgvector + RLS) |
| **AI** | OpenAI-compatible APIs (Chat, Embedding, Rerank) |

## Development Commands

### Frontend (pnpm)

```bash
cd frontend
pnpm dev          # Next.js dev server (localhost:3000)
pnpm build        # Production build
pnpm lint         # ESLint
```

### Backend (pip + requirements.txt)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload               # API server (localhost:8000)
# API docs: http://localhost:8000/docs

# Celery Workers (background processing)
celery -A app.celery_app worker --loglevel=info --queues=high,default --pool=solo  # Windows
celery -A app.celery_app worker --loglevel=info --queues=high,default --concurrency=5  # Linux/Mac
celery -A app.celery_app flower --port=5555  # Monitoring (optional)
```

## Architecture

### Monorepo Structure

```
SaveHub_Supabase/
├── frontend/                    # Next.js application
│   ├── app/                     # App Router pages
│   │   └── (reader)/
│   │       ├── all|unread|starred/   # RSS article views
│   │       ├── feed/[feedId]/        # Single feed view
│   │       ├── repository/           # GitHub repo browser
│   │       ├── chat/                 # AI chat interface
│   │       └── settings/             # Settings pages
│   ├── components/
│   │   ├── sidebar/             # Navigation sidebar
│   │   ├── repository/          # Repo browser components
│   │   └── chat/                # Chat interface components
│   ├── lib/
│   │   ├── store/               # Zustand slices (8 slices)
│   │   ├── api/                 # Backend API clients
│   │   └── types.ts             # Zod schemas + TypeScript types
│   └── CLAUDE.md
├── backend/                     # FastAPI application
│   └── app/
│       ├── api/routers/         # API endpoints (13 routers)
│       ├── schemas/             # Pydantic models
│       ├── services/
│       │   ├── ai/              # AI clients (Chat, Embedding, Rerank)
│       │   ├── rag/             # RAG pipeline (chunker, retriever)
│       │   └── db/              # Database services
│       └── celery_app/          # Background task processors
└── docs/                        # Documentation (reference only)
```

### Core Modules

| Module | Frontend | Backend | Description |
|--------|----------|---------|-------------|
| **RSS Reader** | `/all`, `/unread`, `/starred`, `/feed/[id]` | `routers/feeds.py`, `routers/articles.py`, `routers/rss.py` | Feed subscription and article management |
| **Repository Browser** | `/repository` | `routers/repositories.py`, `routers/github.py` | GitHub repo tracking with OpenRank metrics |
| **AI Chat** | `/chat` | `routers/chat.py`, `routers/rag_chat.py` | RAG-powered Q&A over saved content |
| **Settings** | `/settings/*` | `routers/settings.py`, `routers/api_configs.py` | User preferences and API configuration |

### Backend Services

```
services/
├── ai/                    # Unified AI service module
│   ├── config.py          # API config decryption + URL normalization
│   ├── clients.py         # ChatClient, EmbeddingClient, RerankClient
│   └── repository_service.py  # Repository analysis with AI
├── rag/                   # RAG pipeline
│   ├── chunker.py         # HTML parsing + semantic chunking
│   └── retriever.py       # pgvector similarity search
├── db/                    # Database services (user-scoped CRUD)
├── realtime.py            # WebSocket connection manager
└── supabase_realtime.py   # Postgres changes → WebSocket forwarder
```

### Background Processing (Celery)

| Pipeline | File | Description |
|----------|------|-------------|
| **RSS Feed Processing** | `tasks.py` | Feed refresh with rate limiting |
| **Repository Sync** | `repository_tasks.py` | GitHub metadata sync |
| **Image Processing** | `image_processor.py` | Image compression + AI captioning |
| **RAG Processing** | `rag_processor.py` | Article chunking + embedding |
| **Repo Extraction** | `repo_extractor.py` | Repository content extraction |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  Zustand Store (8 slices) ←→ HTTP API ←→ WebSocket (realtime)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│  FastAPI Routers → Pydantic Validation → Services → Supabase    │
│                              ↓                                   │
│  Celery Workers → Background Processing → AI Services           │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                         Database                                 │
│  PostgreSQL + pgvector (embeddings) + RLS (row-level security)  │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication

Both frontend and backend use Supabase JWT:
- **Frontend**: `@supabase/ssr` for cookie-based sessions
- **Backend**: `verify_jwt` dependency validates `Authorization: Bearer <token>`
- **Service Role**: Background tasks use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)

## Environment Variables

### Frontend (`.env`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_FASTAPI_WS_URL=ws://localhost:8000  # WebSocket (production)
NEXT_PUBLIC_WS_PORT=8000                         # WebSocket port (development)
```

### Backend (`.env`)
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # For background tasks (bypasses RLS)
REDIS_URL=                   # Celery broker
ENCRYPTION_KEY=              # AES-256 key for API config encryption
```

## Key Patterns

### Database Operations

- **User-scoped queries**: Always include `.eq("user_id", userId)`
- **Date handling**: App uses `Date` objects; DB uses ISO strings
- **Two client types** (backend): RLS client (user requests) vs Service client (background tasks)
- **Vector search**: pgvector for semantic similarity (`search_embeddings()`)

### AI Integration

```python
from app.services.ai import ChatClient, EmbeddingClient, get_user_ai_configs

# Get decrypted configs
configs = get_user_ai_configs(supabase, user_id)

# Chat completion (also supports vision)
chat = ChatClient(**configs["chat"])
response = await chat.complete(messages)
caption = await chat.vision_caption(image_url)

# Embedding
embedding = EmbeddingClient(**configs["embedding"])
vectors = await embedding.embed_batch(texts)
```

### RAG Pipeline

```python
from app.services.rag import parse_article_content, chunk_text_semantic, search_embeddings

# 1. Parse HTML → structured content
parsed = parse_article_content(title, author, html, base_url)

# 2. Chunk text semantically
chunks = chunk_text_semantic(text, api_key, api_base, model)

# 3. Generate embeddings → store in pgvector
vectors = await embedding.embed_batch(chunks)

# 4. Retrieve relevant chunks
results = search_embeddings(supabase, query_vector, user_id, limit=10)
```

### Adding Features

1. **New Zustand slice**: Add to `frontend/lib/store/*.slice.ts`, export in `index.ts`
2. **New API client**: Add to `frontend/lib/api/*.ts`
3. **New API endpoint**: Add router in `backend/app/api/routers/`, register in `main.py`
4. **New DB service**: Add to `backend/app/services/db/`
5. **New background task**: Add to `backend/app/celery_app/`, register in `celery.py`
6. **New page**: Use `ArticlePageLayout` wrapper for article list pages

## Module-Specific Documentation

| Module | Location | Description |
|--------|----------|-------------|
| Frontend | `frontend/CLAUDE.md` | Routing, components, state management |
| Backend Services | `backend/app/services/CLAUDE.md` | Service layer patterns |
| AI Services | `backend/app/services/ai/CLAUDE.md` | Chat, Embedding, Vision clients |
| RAG Services | `backend/app/services/rag/CLAUDE.md` | Chunking, retrieval pipeline |
| Pydantic Schemas | `backend/app/schemas/CLAUDE.md` | Schema conventions |
| Database Migrations | `backend/scripts/` | SQL scripts (run in Supabase SQL Editor) |

## URL Routes (Frontend)

| Route | Component | Description |
|-------|-----------|-------------|
| `/all` | ArticleList | All articles |
| `/unread` | ArticleList | Unread articles |
| `/starred` | ArticleList | Starred articles |
| `/feed/[feedId]` | ArticleList | Single feed articles |
| `/feed/[feedId]/properties` | EditFeedForm | Edit feed properties |
| `/repository` | RepositoryPage | GitHub repository browser |
| `/chat` | ChatPage | AI chat interface |
| `/settings/general` | GeneralSettings | General settings |
| `/settings/appearance` | AppearanceSettings | Theme settings |
| `/settings/storage` | StorageSettings | Data retention |
| `/settings/api` | ApiSettings | AI API configuration |
| `/settings/github-token` | GitHubTokenSettings | GitHub API token |

## API Routers (Backend)

| Router | Endpoints | Description |
|--------|-----------|-------------|
| `feeds.py` | `/api/feeds/*` | Feed CRUD |
| `articles.py` | `/api/articles/*` | Article CRUD + batch operations |
| `folders.py` | `/api/folders/*` | Folder CRUD |
| `rss.py` | `/api/rss/*` | RSS parsing and validation |
| `repositories.py` | `/api/repositories/*` | Repository CRUD |
| `github.py` | `/api/github/*` | GitHub API proxy |
| `chat.py` | `/api/chat/*` | AI chat completion |
| `rag_chat.py` | `/api/rag-chat/*` | RAG-powered chat |
| `rag.py` | `/api/rag/*` | RAG processing triggers |
| `api_configs.py` | `/api/api-configs/*` | AI API configuration |
| `settings.py` | `/api/settings/*` | User settings |
| `queue.py` | `/api/queue/*` | Celery task management |
| `websocket.py` | `/api/ws/*` | WebSocket endpoints |
