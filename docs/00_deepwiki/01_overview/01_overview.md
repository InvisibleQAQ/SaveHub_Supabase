
# Overview

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [CLAUDE.md](CLAUDE.md)
- [backend/app/api/routers/feeds.py](backend/app/api/routers/feeds.py)
- [backend/app/api/routers/rag.py](backend/app/api/routers/rag.py)
- [backend/app/api/routers/repositories.py](backend/app/api/routers/repositories.py)
- [backend/app/api/routers/websocket.py](backend/app/api/routers/websocket.py)
- [backend/app/celery_app/CLAUDE.md](backend/app/celery_app/CLAUDE.md)
- [backend/app/celery_app/celery.py](backend/app/celery_app/celery.py)
- [backend/app/celery_app/image_processor.py](backend/app/celery_app/image_processor.py)
- [backend/app/celery_app/rag_processor.py](backend/app/celery_app/rag_processor.py)
- [backend/app/celery_app/repository_tasks.py](backend/app/celery_app/repository_tasks.py)
- [backend/app/celery_app/tasks.py](backend/app/celery_app/tasks.py)
- [backend/app/main.py](backend/app/main.py)
- [backend/app/schemas/repositories.py](backend/app/schemas/repositories.py)
- [backend/app/services/ai/CLAUDE.md](backend/app/services/ai/CLAUDE.md)
- [backend/app/services/ai/__init__.py](backend/app/services/ai/__init__.py)
- [backend/app/services/ai/clients.py](backend/app/services/ai/clients.py)
- [backend/app/services/ai/config.py](backend/app/services/ai/config.py)
- [backend/app/services/ai/repository_service.py](backend/app/services/ai/repository_service.py)
- [backend/app/services/db/repositories.py](backend/app/services/db/repositories.py)
- [backend/app/services/openrank_service.py](backend/app/services/openrank_service.py)
- [backend/app/services/rag/CLAUDE.md](backend/app/services/rag/CLAUDE.md)
- [backend/app/services/rag/__init__.py](backend/app/services/rag/__init__.py)
- [backend/app/services/rag/chunker.py](backend/app/services/rag/chunker.py)
- [backend/app/services/repository_analyzer.py](backend/app/services/repository_analyzer.py)
- [backend/scripts/030_add_repository_openrank.sql](backend/scripts/030_add_repository_openrank.sql)
- [frontend/components/add-feed-dialog.tsx](frontend/components/add-feed-dialog.tsx)
- [frontend/components/repository/repository-card.tsx](frontend/components/repository/repository-card.tsx)
- [frontend/components/repository/repository-page.tsx](frontend/components/repository/repository-page.tsx)
- [frontend/lib/api/repositories.ts](frontend/lib/api/repositories.ts)
- [frontend/lib/store/repositories.slice.ts](frontend/lib/store/repositories.slice.ts)
- [frontend/lib/types.ts](frontend/lib/types.ts)

</details>



## Purpose and Scope

SaveHub is an AI-powered knowledge management system that combines RSS feed aggregation, GitHub repository tracking, and semantic search capabilities. This document provides a high-level overview of the system architecture, core technologies, major components, and data flows.

For detailed information about specific subsystems:
- System design patterns and architectural decisions: [System Architecture](#3)
- Frontend implementation details: [Frontend Application](#4)
- Backend service layer: [Backend Services](#5)
- Background processing pipelines: [Background Processing](#6)
- Database schema and vector storage: [Data Layer](#7)
- AI integration and configuration: [AI Integration](#8)

**Sources:** [CLAUDE.md:14-21](), [backend/app/main.py:1-88](), [frontend/lib/types.ts:1-147]()

---

## Core Technologies

SaveHub is built as a **monorepo** with three distinct layers:

| Layer | Technology Stack | Location |
|-------|-----------------|----------|
| **Frontend** | Next.js 14 (App Router), React 18, Zustand, shadcn/ui, TypeScript | `frontend/` |
| **Backend** | FastAPI, Supabase Python SDK, Pydantic | `backend/app/` |
| **Background Processing** | Celery, Redis (broker), AsyncIO | `backend/app/celery_app/` |
| **Database** | Supabase PostgreSQL, pgvector, Object Storage | Managed service |
| **AI Services** | OpenAI-compatible APIs (OpenAI, DeepSeek, DashScope) | External |

**Sources:** [CLAUDE.md:14-21](), [backend/app/main.py:43-76](), [backend/app/celery_app/celery.py:1-117]()

---

## System Architecture Overview

```mermaid
graph TB
    subgraph "Frontend (Next.js)"
        AppRouter["app/ (App Router)"]
        Components["components/"]
        Store["lib/store/ (Zustand)"]
        ApiClient["lib/api/ (fetchWithAuth)"]
        
        Store --> ApiClient
        AppRouter --> Components
        Components --> Store
    end
    
    subgraph "Backend (FastAPI)"
        MainApp["main.py (FastAPI app)"]
        Routers["api/routers/"]
        Services["services/db/"]
        AIServices["services/ai/"]
        
        MainApp --> Routers
        Routers --> Services
        Routers --> AIServices
    end
    
    subgraph "Background (Celery)"
        CeleryApp["celery_app/celery.py"]
        Tasks["tasks.py (RSS refresh)"]
        ImageProc["image_processor.py"]
        RagProc["rag_processor.py"]
        RepoTasks["repository_tasks.py"]
        RepoExtract["repo_extractor.py"]
        
        CeleryApp --> Tasks
        CeleryApp --> ImageProc
        CeleryApp --> RagProc
        CeleryApp --> RepoTasks
        CeleryApp --> RepoExtract
    end
    
    subgraph "Data (Supabase)"
        Postgres["PostgreSQL + RLS"]
        Vector["pgvector (all_embeddings)"]
        Storage["Object Storage (article-images)"]
        
        Postgres --> Vector
    end
    
    subgraph "External"
        GitHub["GitHub API"]
        OpenRank["OpenRank API"]
        OpenAI["OpenAI-compatible APIs"]
        RSSFeeds["External RSS Feeds"]
    end
    
    ApiClient -->|HTTP| Routers
    ApiClient -->|WebSocket| WSRouter["api/routers/websocket.py"]
    WSRouter -.->|Realtime| Postgres
    
    Routers --> Services
    Services --> Postgres
    AIServices --> OpenAI
    
    Tasks --> RSSFeeds
    Tasks --> Postgres
    RepoTasks --> GitHub
    RepoTasks --> OpenRank
    RepoExtract --> GitHub
    ImageProc --> Storage
    RagProc --> Vector
    RagProc --> AIServices
    
    Redis["Redis (Broker)"] --> CeleryApp
```

**Description:** SaveHub follows a three-tier architecture with clear separation between frontend (user interaction), backend (API and business logic), and background processing (asynchronous tasks). The frontend communicates with the backend via HTTP and WebSocket. Background workers consume tasks from Redis and interact with external services.

**Sources:** [backend/app/main.py:43-88](), [backend/app/celery_app/celery.py:26-116](), [frontend/lib/store/index.ts](), [CLAUDE.md:46-64]()

---

## Main Components and File Structure

### Frontend Components

| Path | Responsibility |
|------|---------------|
| `frontend/app/` | Next.js App Router pages and layouts |
| `frontend/components/` | Reusable React components (article list, repository cards, chat UI) |
| `frontend/lib/store/` | Zustand state management with 7 slices (database, folders, feeds, articles, repositories, UI, settings) |
| `frontend/lib/api/` | API client layer with `fetchWithAuth` for authenticated requests |

**Sources:** [CLAUDE.md:46-64](), [frontend/lib/types.ts:76-101]()

### Backend Components

| Path | Responsibility |
|------|---------------|
| `backend/app/main.py` | FastAPI application entry point, router registration, CORS middleware |
| `backend/app/api/routers/` | API endpoints (`articles.py`, `feeds.py`, `repositories.py`, `rag.py`, `rag_chat.py`, etc.) |
| `backend/app/services/db/` | Database service layer (`ArticleService`, `FeedService`, `RepositoryService`, `RagService`) |
| `backend/app/services/ai/` | AI client abstractions (`ChatClient`, `EmbeddingClient`, `RepositoryAnalyzerService`) |
| `backend/app/schemas/` | Pydantic models for request/response validation |

**Sources:** [backend/app/main.py:43-88](), [backend/app/api/routers/repositories.py:1-486]()

### Background Processing Components

| Path | Responsibility |
|------|---------------|
| `backend/app/celery_app/celery.py` | Celery configuration, beat schedule, task routing |
| `backend/app/celery_app/tasks.py` | RSS feed refresh tasks (`refresh_feed`, `refresh_feed_batch`, `scan_due_feeds`) |
| `backend/app/celery_app/image_processor.py` | Image download, compression, upload (`process_article_images`) |
| `backend/app/celery_app/rag_processor.py` | RAG embedding generation (`process_article_rag`) |
| `backend/app/celery_app/repository_tasks.py` | GitHub sync (`sync_repositories`, `do_repository_embedding`) |
| `backend/app/celery_app/repo_extractor.py` | Extract GitHub repos from article content (`extract_article_repos`) |

**Sources:** [backend/app/celery_app/CLAUDE.md:1-150](), [backend/app/celery_app/celery.py:26-116]()

---

## Core Features

SaveHub provides three primary content management workflows:

### 1. RSS Feed Management

Users subscribe to RSS feeds, which are automatically refreshed at configurable intervals. Articles are parsed, images are downloaded and optimized, and content is indexed for semantic search.

**Key routers:** `api/routers/feeds.py`, `api/routers/articles.py`  
**Background tasks:** `refresh_feed`, `process_article_images`, `process_article_rag`  
**Database tables:** `feeds`, `articles`, `all_embeddings`

**Sources:** [backend/app/api/routers/feeds.py:1-220](), [backend/app/celery_app/tasks.py:256-446]()

### 2. GitHub Repository Tracking

Users connect their GitHub account to sync starred repositories. The system fetches README content, generates AI-powered summaries and tags, retrieves OpenRank metrics, and creates embeddings for semantic search.

**Key routers:** `api/routers/repositories.py`  
**Background tasks:** `sync_repositories`, `do_ai_analysis`, `do_repository_embedding`  
**Database tables:** `repositories`, `all_embeddings`, `article_repositories`

**Sources:** [backend/app/api/routers/repositories.py:48-301](), [backend/app/celery_app/repository_tasks.py:496-637]()

### 3. AI-Powered Chat & Search

Users can search across both articles and repositories using natural language queries. The system uses Self-RAG (Retrieval-Augmented Generation) to retrieve relevant content and generate answers with inline references.

**Key routers:** `api/routers/rag.py`, `api/routers/rag_chat.py`  
**Services:** `RagService.search()`, `search_all_embeddings` RPC  
**Database:** `all_embeddings` table with pgvector similarity search

**Sources:** [backend/app/api/routers/rag.py:83-150](), [backend/app/services/db/rag.py]()

---

## HTTP API Endpoints

```mermaid
graph LR
    subgraph "Authentication"
        AuthRouter["/api/auth"]
        AuthRouter --> Login["/login<br/>(POST)"]
        AuthRouter --> Logout["/logout<br/>(POST)"]
        AuthRouter --> Refresh["/refresh<br/>(POST)"]
    end
    
    subgraph "Content Management"
        FeedsRouter["/api/feeds"]
        ArticlesRouter["/api/articles"]
        FoldersRouter["/api/folders"]
        
        FeedsRouter --> GetFeeds["GET /"]
        FeedsRouter --> CreateFeed["POST /"]
        FeedsRouter --> UpdateFeed["PUT /{id}"]
        FeedsRouter --> DeleteFeed["DELETE /{id}"]
        
        ArticlesRouter --> GetArticles["GET /"]
        ArticlesRouter --> MarkRead["PATCH /{id}"]
        ArticlesRouter --> DeleteOld["DELETE /old"]
    end
    
    subgraph "Repositories"
        ReposRouter["/api/repositories"]
        ReposRouter --> GetRepos["GET /"]
        ReposRouter --> SyncRepos["POST /sync<br/>(SSE)"]
        ReposRouter --> UpdateRepo["PATCH /{id}"]
        ReposRouter --> AnalyzeRepo["POST /{id}/analyze"]
    end
    
    subgraph "RAG & AI"
        RagRouter["/api/rag"]
        ChatRouter["/api/rag-chat"]
        
        RagRouter --> RagQuery["POST /query"]
        RagRouter --> RagStatus["GET /status"]
        RagRouter --> RagReindex["POST /reindex/{id}"]
        
        ChatRouter --> ChatStream["POST /stream<br/>(SSE)"]
    end
    
    subgraph "Utilities"
        ProxyRouter["/api/proxy"]
        ProxyRouter --> ImageProxy["GET /image"]
        
        SettingsRouter["/api/settings"]
        ConfigsRouter["/api/api-configs"]
    end
    
    Client["Frontend Client"] --> AuthRouter
    Client --> FeedsRouter
    Client --> ArticlesRouter
    Client --> ReposRouter
    Client --> RagRouter
    Client --> ChatRouter
```

**Description:** All API endpoints require authentication via JWT token stored in `sb_access_token` cookie. The `verify_auth` dependency validates tokens on each request. SSE (Server-Sent Events) endpoints are used for long-running operations like repository sync and AI chat streaming.

**Sources:** [backend/app/main.py:58-76](), [backend/app/dependencies.py](), [backend/app/api/routers/repositories.py:48-301]()

---

## Background Task Orchestration

SaveHub uses Celery with Redis as the broker to handle asynchronous processing. Tasks are organized into several pipelines with dependencies:

```mermaid
graph TB
    subgraph "Feed Refresh Pipeline"
        TriggerFeed["Trigger: POST /feeds<br/>or scan_due_feeds"]
        TriggerFeed --> RefreshFeed["refresh_feed<br/>(tasks.py)"]
        RefreshFeed --> ParseRSS["Parse RSS + Save Articles"]
        ParseRSS --> ScheduleImg["schedule_image_processing<br/>(Chord)"]
        ScheduleImg --> ImgTasks["process_article_images<br/>(Parallel)"]
        ImgTasks --> OnImgComplete["on_images_complete"]
        OnImgComplete --> ScheduleRAG["schedule_rag_for_articles"]
        ScheduleRAG --> RAGTasks["process_article_rag<br/>(Staggered)"]
        RAGTasks --> ExtractRepos["extract_article_repos"]
    end
    
    subgraph "Repository Sync Pipeline"
        TriggerRepo["Trigger: POST /repositories/sync"]
        TriggerRepo --> SyncRepo["sync_repositories<br/>(repository_tasks.py)"]
        SyncRepo --> FetchStarred["Fetch GitHub Starred"]
        FetchStarred --> FetchReadme["Fetch README"]
        FetchReadme --> AIAnalysis["do_ai_analysis"]
        AIAnalysis --> OpenRank["do_openrank_update"]
        OpenRank --> RepoEmbed["do_repository_embedding"]
    end
    
    subgraph "Scheduled Scans (Celery Beat)"
        Beat["Celery Beat"]
        Beat -->|Every 1 min| ScanDue["scan_due_feeds"]
        Beat -->|Every 30 min| ScanRAG["scan_pending_rag_articles"]
        Beat -->|Every 30 min| ScanExtract["scan_pending_repo_extraction"]
    end
    
    Redis["Redis<br/>(Broker + Backend)"] -.->|Enqueue| RefreshFeed
    Redis -.->|Enqueue| SyncRepo
    
    ExtractRepos -.->|Auto-trigger| SyncRepo
```

**Description:** Background tasks follow a pipeline pattern where each stage triggers the next. The feed refresh pipeline processes articles through image optimization and RAG indexing. The repository sync pipeline fetches data from GitHub, runs AI analysis, and generates embeddings. Celery Beat provides scheduled scanning for missed processing.

**Sources:** [backend/app/celery_app/CLAUDE.md:5-76](), [backend/app/celery_app/celery.py:98-116](), [backend/app/celery_app/tasks.py:256-918]()

---

## Data Flow: Article Ingestion

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant FeedsAPI as /api/feeds
    participant RefreshTask as refresh_feed
    participant ImageTask as process_article_images
    participant RAGTask as process_article_rag
    participant DB as PostgreSQL
    participant Storage as Supabase Storage
    participant AI as OpenAI API
    participant Vector as pgvector
    
    User->>Frontend: Add RSS Feed
    Frontend->>FeedsAPI: POST /feeds
    FeedsAPI->>DB: INSERT feed
    FeedsAPI->>RefreshTask: schedule refresh_feed
    
    RefreshTask->>RefreshTask: Parse RSS (rss_parser.py)
    RefreshTask->>DB: UPSERT articles
    RefreshTask->>ImageTask: schedule Chord
    
    par Parallel Image Processing
        ImageTask->>ImageTask: Download image
        ImageTask->>ImageTask: Compress (image_compressor.py)
        ImageTask->>Storage: Upload to bucket
        ImageTask->>DB: Update article.content
    end
    
    ImageTask->>RAGTask: on_images_complete callback
    
    RAGTask->>RAGTask: Parse HTML (chunker.py)
    RAGTask->>AI: Generate image captions
    RAGTask->>RAGTask: Semantic chunking
    RAGTask->>AI: Generate embeddings
    RAGTask->>Vector: INSERT all_embeddings
    RAGTask->>DB: UPDATE rag_processed=true
    
    DB-->>Frontend: WebSocket notification
    Frontend-->>User: Show new article
```

**Description:** Article ingestion follows a multi-stage pipeline: RSS parsing → image processing → RAG indexing. Each stage updates database status fields (`images_processed`, `rag_processed`, `repos_extracted`) to track progress and enable selective reprocessing.

**Sources:** [backend/app/celery_app/tasks.py:57-217](), [backend/app/celery_app/image_processor.py:108-258](), [backend/app/celery_app/rag_processor.py:87-267]()

---

## Data Flow: Repository Sync

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant RepoAPI as /api/repositories/sync
    participant SyncTask as sync_repositories
    participant GitHub
    participant AIService
    participant OpenRank
    participant DB as PostgreSQL
    participant Vector as pgvector
    
    User->>Frontend: Click Sync
    Frontend->>RepoAPI: POST /sync (SSE)
    RepoAPI->>SyncTask: Trigger async task
    
    SyncTask->>GitHub: GET /user/starred
    SyncTask->>RepoAPI: SSE: phase=fetching
    SyncTask->>GitHub: GET /repos/{owner}/{repo}/readme
    SyncTask->>RepoAPI: SSE: phase=fetched
    
    SyncTask->>DB: UPSERT repositories
    
    SyncTask->>AIService: analyze_repositories_needing_analysis
    loop For each repo needing analysis
        AIService->>AIService: ChatClient.complete()
        AIService->>AIService: Extract summary/tags/platforms
        AIService->>DB: UPDATE ai_summary, ai_tags, ai_platforms
        AIService->>RepoAPI: SSE: phase=analyzing
    end
    
    SyncTask->>OpenRank: GET /github/{owner}/{repo}/openrank.json
    SyncTask->>DB: UPDATE openrank
    SyncTask->>RepoAPI: SSE: phase=openrank
    
    SyncTask->>SyncTask: do_repository_embedding
    loop For each repo
        SyncTask->>SyncTask: Semantic chunking (README)
        SyncTask->>AIService: EmbeddingClient.embed_batch()
        SyncTask->>Vector: INSERT all_embeddings
        SyncTask->>RepoAPI: SSE: phase=embedding
    end
    
    SyncTask->>DB: UPDATE embedding_processed=true
    SyncTask->>RepoAPI: SSE: event=done
    RepoAPI-->>Frontend: Close SSE stream
    Frontend-->>User: Show sync results
```

**Description:** Repository sync uses Server-Sent Events (SSE) to stream progress updates to the frontend. The process fetches metadata from GitHub, analyzes README content with AI, retrieves OpenRank metrics, and generates embeddings for semantic search. All phases run synchronously within the API request for immediate user feedback.

**Sources:** [backend/app/api/routers/repositories.py:48-301](), [backend/app/celery_app/repository_tasks.py:35-278](), [backend/app/services/repository_analyzer.py:19-103]()

---

## Database Schema Overview

```mermaid
erDiagram
    users ||--o{ feeds : owns
    users ||--o{ articles : owns
    users ||--o{ repositories : owns
    users ||--o{ folders : owns
    users ||--o{ settings : has
    users ||--o{ api_configs : configures
    
    folders ||--o{ feeds : contains
    feeds ||--o{ articles : publishes
    
    articles ||--o{ all_embeddings : "has embeddings"
    repositories ||--o{ all_embeddings : "has embeddings"
    
    articles }o--o{ repositories : "links via article_repositories"
    
    users {
        uuid id PK
        string email
        timestamp created_at
    }
    
    feeds {
        uuid id PK
        uuid user_id FK
        uuid folder_id FK
        string title
        string url
        int refresh_interval
        timestamp last_fetched
        string last_fetch_status
    }
    
    articles {
        uuid id PK
        uuid user_id FK
        uuid feed_id FK
        string title
        text content
        string url
        boolean is_read
        boolean is_starred
        boolean images_processed
        boolean rag_processed
        boolean repos_extracted
        timestamp published_at
    }
    
    repositories {
        uuid id PK
        uuid user_id FK
        int github_id
        string full_name
        text readme_content
        string ai_summary
        jsonb ai_tags
        jsonb ai_platforms
        float openrank
        boolean embedding_processed
        timestamp analyzed_at
    }
    
    all_embeddings {
        uuid id PK
        uuid user_id FK
        uuid article_id FK
        uuid repository_id FK
        int chunk_index
        text content
        vector embedding
        timestamp created_at
    }
    
    article_repositories {
        uuid id PK
        uuid article_id FK
        uuid repository_id FK
        string extraction_method
    }
```

**Description:** SaveHub uses a multi-tenant database design with RLS (Row Level Security) enforcing `user_id` isolation. The `all_embeddings` table unifies vector search across articles and repositories using pgvector. Processing status is tracked via boolean flags (`images_processed`, `rag_processed`, `embedding_processed`) to enable selective reprocessing and compensatory scans.

**Sources:** [backend/scripts/](), [backend/app/services/db/repositories.py:1-565](), [backend/app/services/db/rag.py]()

---

## State Management (Frontend)

The frontend uses Zustand with 7 modular slices for state management:

```mermaid
graph TB
    RootStore["useRSSStore<br/>(Combined Store)"]
    
    RootStore --> DBSlice["DatabaseSlice<br/>isDatabaseReady"]
    RootStore --> FoldersSlice["FoldersSlice<br/>folders[], CRUD actions"]
    RootStore --> FeedsSlice["FeedsSlice<br/>feeds[], CRUD actions"]
    RootStore --> ArticlesSlice["ArticlesSlice<br/>articles[], filters"]
    RootStore --> ReposSlice["RepositoriesSlice<br/>repositories[], sync"]
    RootStore --> UISlice["UISlice<br/>theme, sidebar state"]
    RootStore --> SettingsSlice["SettingsSlice<br/>user preferences"]
    
    FeedsSlice --> FeedsAPI["articlesApi.getAll()"]
    ArticlesSlice --> ArticlesAPI["feedsApi.create()"]
    ReposSlice --> ReposAPI["repositoriesApi.syncWithProgress()"]
    
    WebSocket["use-realtime-sync.ts"] -.Real-time updates.-> DBSlice
    WebSocket -.-> FoldersSlice
    WebSocket -.-> FeedsSlice
    WebSocket -.-> ArticlesSlice
    
    URLRouter["App Router<br/>(URL as source of truth)"] --> Component["React Components"]
    Component --> RootStore
```

**Description:** Zustand slices are organized by domain concern. View state (selected feed, article filters) is derived from URL params using Next.js App Router, not stored in Zustand. Real-time updates arrive via WebSocket and trigger store updates. Each slice manages its own API calls through `lib/api/` client modules.

**Sources:** [frontend/lib/store/index.ts](), [frontend/lib/store/repositories.slice.ts:1-107](), [CLAUDE.md:68-78]()

---

## AI Service Integration

```mermaid
graph TB
    subgraph "Configuration (api_configs table)"
        ChatConfig["type: chat<br/>(encrypted api_key, api_base)"]
        EmbedConfig["type: embedding<br/>(encrypted api_key, api_base)"]
        RerankConfig["type: rerank<br/>(placeholder)"]
    end
    
    subgraph "AI Service Layer (services/ai/)"
        GetConfigs["get_user_ai_configs()<br/>(config.py)"]
        
        ChatClient["ChatClient<br/>(AsyncOpenAI)"]
        EmbedClient["EmbeddingClient<br/>(AsyncOpenAI)"]
        
        GetConfigs --> Decrypt["decrypt() + normalize_base_url()"]
        Decrypt --> ChatClient
        Decrypt --> EmbedClient
    end
    
    subgraph "Use Cases"
        RepoAnalyzer["RepositoryAnalyzerService<br/>Extract summary/tags/platforms"]
        VisionCaption["vision_caption()<br/>Generate image descriptions"]
        RagEmbed["process_article_rag<br/>Generate article embeddings"]
        RepoEmbed["do_repository_embedding<br/>Generate repo embeddings"]
        RagQuery["RAG query<br/>Embed user query"]
    end
    
    ChatConfig --> GetConfigs
    EmbedConfig --> GetConfigs
    
    ChatClient --> RepoAnalyzer
    ChatClient --> VisionCaption
    EmbedClient --> RagEmbed
    EmbedClient --> RepoEmbed
    EmbedClient --> RagQuery
    
    OpenAI["OpenAI-compatible API<br/>(OpenAI, DeepSeek, DashScope)"] --> ChatClient
    OpenAI --> EmbedClient
```

**Description:** AI configuration is stored encrypted in the `api_configs` table. The `services/ai/` module provides unified client abstractions (`ChatClient`, `EmbeddingClient`) that work with any OpenAI-compatible API. URL normalization ensures consistent `/v1` suffix for SDK compatibility. All AI operations use async/await with proper timeout and retry handling.

**Sources:** [backend/app/services/ai/config.py:1-166](), [backend/app/services/ai/clients.py:1-310](), [backend/app/services/ai/repository_service.py:1-397]()

---

## Real-Time Synchronization

```mermaid
sequenceDiagram
    participant Client1 as Frontend Client 1
    participant Client2 as Frontend Client 2
    participant WSRouter as /api/ws (WebSocket)
    participant Forwarder as realtime_forwarder
    participant Supabase as Supabase Realtime
    participant DB as PostgreSQL
    
    Client1->>WSRouter: Connect WebSocket (with cookie)
    WSRouter->>WSRouter: authenticate_websocket()
    WSRouter->>Client1: Connection accepted
    
    Client2->>WSRouter: Connect WebSocket
    WSRouter->>Client2: Connection accepted
    
    Note over Forwarder,Supabase: On app startup
    Forwarder->>Supabase: Subscribe to postgres_changes
    
    Client1->>Client1: User marks article as read
    Client1->>DB: PATCH /api/articles/{id}
    DB->>DB: UPDATE articles SET is_read=true
    
    DB->>Supabase: postgres_changes event
    Supabase->>Forwarder: Forward event
    Forwarder->>WSRouter: Broadcast to all connections
    WSRouter->>Client1: Update message
    WSRouter->>Client2: Update message
    
    Client2->>Client2: Zustand store update
    Client2->>Client2: Re-render UI
```

**Description:** SaveHub uses a dual-channel synchronization strategy: HTTP for mutations (optimistic updates), WebSocket for real-time subscriptions. The `realtime_forwarder` service subscribes to Supabase's postgres_changes and broadcasts updates to all authenticated WebSocket clients. Frontend optimistically updates local state, then receives authoritative updates via WebSocket.

**Sources:** [backend/app/services/supabase_realtime.py](), [backend/app/api/routers/websocket.py:1-102](), [frontend/lib/hooks/use-realtime-sync.ts]()

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant Browser
    participant Frontend
    participant AuthAPI as /api/auth
    participant Supabase
    participant Backend as Backend API
    
    Browser->>Frontend: Visit /login
    Frontend->>AuthAPI: POST /login (email, password)
    AuthAPI->>Supabase: auth.sign_in_with_password()
    Supabase-->>AuthAPI: {access_token, refresh_token, user}
    
    AuthAPI->>Browser: Set-Cookie: sb_access_token (httpOnly)
    AuthAPI->>Browser: Set-Cookie: sb_refresh_token (httpOnly)
    AuthAPI-->>Frontend: {user}
    
    Frontend->>Frontend: Redirect to /all
    
    Note over Frontend,Backend: Subsequent API calls
    Frontend->>Backend: GET /api/articles (cookie auto-sent)
    Backend->>Backend: verify_auth() reads cookie
    Backend->>Supabase: auth.get_user(access_token)
    Supabase-->>Backend: {user}
    Backend-->>Frontend: Articles data
    
    Note over Frontend,Backend: Token refresh (automatic)
    Frontend->>AuthAPI: POST /refresh (cookie auto-sent)
    AuthAPI->>Supabase: auth.refresh_session(refresh_token)
    Supabase-->>AuthAPI: {new_access_token}
    AuthAPI->>Browser: Update sb_access_token cookie
```

**Description:** SaveHub uses cookie-based JWT authentication. Both frontend and backend use Supabase SDK for auth operations. The `verify_auth` dependency validates the `sb_access_token` cookie on every request. Token refresh is handled automatically by `fetchWithAuth` when tokens expire. WebSocket connections authenticate using the same cookie mechanism.

**Sources:** [backend/app/dependencies.py](), [backend/app/api/routers/auth.py](), [frontend/lib/api/fetch-client.ts]()

---

## Deployment Entry Points

| Component | Entry Point | Command |
|-----------|-------------|---------|
| **Frontend** | `frontend/package.json` | `pnpm dev` (development)<br/>`pnpm build && pnpm start` (production) |
| **Backend API** | `backend/app/main.py` | `uvicorn app.main:app --reload` |
| **Celery Worker** | `backend/app/celery_app/celery.py` | `celery -A app.celery_app worker` |
| **Celery Beat** | `backend/app/celery_app/celery.py` | `celery -A app.celery_app beat` |
| **Flower (monitoring)** | Celery management | `celery -A app.celery_app flower` |

**Environment Variables Required:**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (frontend + backend)
- `SUPABASE_SERVICE_ROLE_KEY` (backend only, for Celery tasks)
- `REDIS_URL` (backend only, for Celery)
- `ENCRYPTION_KEY` (backend only, for API config encryption)

**Sources:** [CLAUDE.md:22-44](), [backend/app/main.py:1-12](), [backend/app/celery_app/celery.py:24-37]()