
# Database Service Layer

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [backend/app/api/routers/articles.py](backend/app/api/routers/articles.py)
- [backend/app/api/routers/folders.py](backend/app/api/routers/folders.py)
- [backend/app/api/routers/proxy.py](backend/app/api/routers/proxy.py)
- [backend/app/api/routers/rag.py](backend/app/api/routers/rag.py)
- [backend/app/api/routers/repositories.py](backend/app/api/routers/repositories.py)
- [backend/app/celery_app/rag_processor.py](backend/app/celery_app/rag_processor.py)
- [backend/app/celery_app/repository_tasks.py](backend/app/celery_app/repository_tasks.py)
- [backend/app/schemas/articles.py](backend/app/schemas/articles.py)
- [backend/app/schemas/repositories.py](backend/app/schemas/repositories.py)
- [backend/app/services/ai/CLAUDE.md](backend/app/services/ai/CLAUDE.md)
- [backend/app/services/ai/__init__.py](backend/app/services/ai/__init__.py)
- [backend/app/services/ai/clients.py](backend/app/services/ai/clients.py)
- [backend/app/services/ai/config.py](backend/app/services/ai/config.py)
- [backend/app/services/ai/repository_service.py](backend/app/services/ai/repository_service.py)
- [backend/app/services/db/articles.py](backend/app/services/db/articles.py)
- [backend/app/services/db/repositories.py](backend/app/services/db/repositories.py)
- [backend/app/services/openrank_service.py](backend/app/services/openrank_service.py)
- [backend/app/services/rag/CLAUDE.md](backend/app/services/rag/CLAUDE.md)
- [backend/app/services/rag/__init__.py](backend/app/services/rag/__init__.py)
- [backend/app/services/rag/chunker.py](backend/app/services/rag/chunker.py)
- [backend/app/services/repository_analyzer.py](backend/app/services/repository_analyzer.py)
- [backend/scripts/030_add_repository_openrank.sql](backend/scripts/030_add_repository_openrank.sql)
- [frontend/components/article-content.tsx](frontend/components/article-content.tsx)
- [frontend/components/article-list.tsx](frontend/components/article-list.tsx)
- [frontend/components/article-repositories.tsx](frontend/components/article-repositories.tsx)
- [frontend/components/repository/repository-card.tsx](frontend/components/repository/repository-card.tsx)
- [frontend/components/repository/repository-page.tsx](frontend/components/repository/repository-page.tsx)
- [frontend/lib/api/repositories.ts](frontend/lib/api/repositories.ts)
- [frontend/lib/store/repositories.slice.ts](frontend/lib/store/repositories.slice.ts)
- [frontend/lib/types.ts](frontend/lib/types.ts)
- [frontend/lib/utils.ts](frontend/lib/utils.ts)
- [image/5.png](image/5.png)

</details>



## Purpose and Scope

The Database Service Layer provides a structured abstraction over Supabase database operations, encapsulating all data access logic for different domain entities. Each service class handles CRUD operations, complex queries, and data transformations for a specific business entity while enforcing user data isolation and security.

This page covers the service classes in [backend/app/services/db/]() that interact with the PostgreSQL database through the Supabase Python SDK. For information about the database schema and tables, see [7.1 Database Schema](#7.1). For vector embedding storage and retrieval, see [7.2 Vector Embeddings](#7.2).

---

## Service Layer Architecture

The service layer follows a Repository Pattern where each service class encapsulates all database operations for a single domain entity. Services are instantiated per-request with user context and provide a clean API for business logic.

### Architectural Pattern

```mermaid
graph TB
    subgraph "API Layer"
        Router1["ArticlesRouter<br/>/api/articles"]
        Router2["RepositoriesRouter<br/>/api/repositories"]
        Router3["FeedsRouter<br/>/api/feeds"]
        Router4["RagRouter<br/>/api/rag"]
    end
    
    subgraph "Dependency Injection"
        DI["FastAPI Depends()<br/>verify_auth"]
        Factory1["get_article_service()"]
        Factory2["get_repository_service()"]
        Factory3["get_rag_service()"]
    end
    
    subgraph "Service Layer"
        ArticleService["ArticleService<br/>articles.py"]
        RepoService["RepositoryService<br/>repositories.py"]
        RagService["RagService<br/>rag.py"]
        FeedService["FeedService"]
        FolderService["FolderService"]
        SettingsService["SettingsService"]
    end
    
    subgraph "Database Client"
        Supabase["Supabase Client<br/>(per-user session)"]
    end
    
    subgraph "Supabase PostgreSQL"
        Articles["articles table"]
        Repos["repositories table"]
        Embeddings["all_embeddings table"]
        Feeds["feeds table"]
        Settings["settings table"]
    end
    
    Router1 --> DI
    Router2 --> DI
    Router3 --> DI
    Router4 --> DI
    
    DI --> Factory1
    DI --> Factory2
    DI --> Factory3
    
    Factory1 --> ArticleService
    Factory2 --> RepoService
    Factory3 --> RagService
    
    ArticleService --> Supabase
    RepoService --> Supabase
    RagService --> Supabase
    FeedService --> Supabase
    FolderService --> Supabase
    SettingsService --> Supabase
    
    Supabase --> Articles
    Supabase --> Repos
    Supabase --> Embeddings
    Supabase --> Feeds
    Supabase --> Settings
```

**Sources:** [backend/app/api/routers/articles.py:26-32](), [backend/app/api/routers/repositories.py:32-36](), [backend/app/api/routers/rag.py:38-45]()

### Service Instantiation Pattern

All services follow a consistent instantiation pattern using FastAPI dependency injection:

```mermaid
sequenceDiagram
    participant Client
    participant Router
    participant verify_auth
    participant Factory
    participant Service
    participant Supabase
    
    Client->>Router: HTTP Request with cookies
    Router->>verify_auth: Depends(verify_auth)
    verify_auth->>verify_auth: Validate JWT token
    verify_auth-->>Router: AuthResponse(user)
    Router->>Factory: get_service_factory()
    Factory->>Factory: Extract access_token from cookies
    Factory->>Supabase: get_supabase_client(access_token)
    Supabase-->>Factory: Client with user session
    Factory->>Service: Service(supabase, user.id)
    Service-->>Router: Service instance
    Router->>Service: Call service methods
    Service->>Supabase: Execute queries with user_id filter
    Supabase-->>Service: Query results
    Service-->>Router: Transformed data
    Router-->>Client: HTTP Response
```

**Sources:** [backend/app/api/routers/articles.py:26-32](), [backend/app/api/routers/repositories.py:32-36]()

---

## Core Service Classes

### ArticleService

`ArticleService` manages all article-related database operations including CRUD, statistics, and repository extraction status tracking.

#### Key Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `save_articles(articles: List[dict])` | Upsert multiple articles with deduplication | None |
| `load_articles(feed_id, limit)` | Load articles with optional filtering | List[dict] |
| `get_article(article_id)` | Get single article by ID | dict \| None |
| `update_article(article_id, updates)` | Update article fields | None |
| `get_article_stats()` | Get total, unread, starred counts | dict |
| `clear_old_articles(days_to_keep)` | Delete old read articles | int |
| `get_articles_needing_repo_extraction(limit)` | Find articles pending repo extraction | List[dict] |
| `mark_repos_extracted(article_id, success)` | Update extraction status | None |

#### Data Flow Example

```mermaid
graph LR
    subgraph "Article Creation Flow"
        API["POST /api/articles"]
        Service["ArticleService.save_articles()"]
        Upsert["supabase.table('articles').upsert()"]
        DB[("articles table<br/>with user_id filter")]
    end
    
    API -->|"List[ArticleCreate]"| Service
    Service -->|"Transform + add user_id"| Upsert
    Upsert -->|"on_conflict: feed_id,content_hash"| DB
    
    subgraph "Article Query Flow"
        API2["GET /api/articles"]
        Service2["ArticleService.load_articles()"]
        Select["supabase.table('articles').select()"]
        DB2[("articles table<br/>join article_repositories")]
        Transform["_row_to_dict()"]
    end
    
    API2 -->|"feed_id?, limit?"| Service2
    Service2 -->|"eq('user_id', user_id)"| Select
    Select --> DB2
    DB2 -->|"rows with repo count"| Transform
    Transform -->|"List[dict]"| API2
```

**Sources:** [backend/app/services/db/articles.py:15-312](), [backend/app/api/routers/articles.py:74-100]()

#### Article Statistics

The `get_article_stats()` method provides comprehensive statistics used by the frontend for displaying unread counts and feed summaries:

```mermaid
graph TB
    Method["get_article_stats()"]
    Query["SELECT id, feed_id, is_read, is_starred<br/>FROM articles<br/>WHERE user_id = ?"]
    Aggregate["Calculate in-memory:<br/>- total<br/>- unread count<br/>- starred count<br/>- by_feed breakdown"]
    Return["Return stats dict"]
    
    Method --> Query
    Query --> Aggregate
    Aggregate --> Return
```

**Sources:** [backend/app/services/db/articles.py:226-263]()

---

### RepositoryService

`RepositoryService` handles GitHub repository data including starred repos, AI analysis results, and OpenRank metrics.

#### Key Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `load_repositories()` | Load all user repositories | List[dict] |
| `upsert_repositories(repos)` | Upsert repos with change detection | dict (stats) |
| `get_repository_by_id(repo_id)` | Get single repository | dict \| None |
| `get_by_github_id(github_id)` | Get repo by GitHub's numeric ID | dict \| None |
| `get_by_full_name(full_name)` | Get repo by owner/name | dict \| None |
| `update_ai_analysis(repo_id, analysis, is_fallback)` | Save AI analysis results | dict \| None |
| `mark_analysis_failed(repo_id)` | Mark analysis as failed | dict \| None |
| `get_repositories_needing_analysis()` | Find repos needing AI analysis | List[dict] |
| `get_repos_without_readme()` | Find repos missing README | List[dict] |
| `update_readme_content(repo_id, content)` | Update README only | bool |
| `upsert_extracted_repository(repo_data)` | Upsert repo from article extraction | dict \| None |
| `batch_update_openrank(openrank_map)` | Bulk update OpenRank values | int |

#### Repository Upsert Logic

The `upsert_repositories()` method implements sophisticated change detection to minimize unnecessary updates:

```mermaid
graph TD
    Start["upsert_repositories(repos)"]
    GetExisting["Query existing repos:<br/>github_id, github_pushed_at, readme_content"]
    Loop["For each repo"]
    CheckNew{"Is new repo?"}
    CheckReadme{"New README<br/>fetched?"}
    CompareReadme{"README<br/>changed?"}
    CheckPushed{"pushed_at<br/>changed?"}
    
    NewRepo["Mark as new<br/>new_count++"]
    ClearAI["Clear AI fields<br/>changed_github_ids.add()"]
    AddToUpsert["Add to db_rows"]
    Skip["Skip (no changes)<br/>skipped_count++"]
    
    Start --> GetExisting
    GetExisting --> Loop
    Loop --> CheckNew
    CheckNew -->|Yes| NewRepo
    CheckNew -->|No| CheckReadme
    NewRepo --> AddToUpsert
    
    CheckReadme -->|None| Skip
    CheckReadme -->|Yes| CompareReadme
    CompareReadme -->|Changed| CheckPushed
    CompareReadme -->|Same| Skip
    
    CheckPushed -->|Yes| ClearAI
    CheckPushed -->|No| AddToUpsert
    ClearAI --> AddToUpsert
    
    AddToUpsert --> Loop
    Skip --> Loop
```

**Sources:** [backend/app/services/db/repositories.py:72-200]()

#### AI Analysis Tracking

Repository AI analysis is tracked through several fields and methods:

| Field | Type | Purpose |
|-------|------|---------|
| `ai_summary` | string | AI-generated description |
| `ai_tags` | string[] | Extracted technical tags |
| `ai_platforms` | string[] | Supported platforms |
| `analyzed_at` | timestamp | When analysis completed |
| `analysis_failed` | boolean | True if analysis failed |

```mermaid
graph LR
    Unanalyzed["analyzed_at IS NULL<br/>analysis_failed = false"]
    Analyzing["AI Analysis Running"]
    Success["analyzed_at set<br/>ai_summary, ai_tags populated<br/>analysis_failed = false"]
    Failed["analyzed_at set<br/>analysis_failed = true"]
    Retry["reset_analysis_failed()<br/>clears flags"]
    
    Unanalyzed --> Analyzing
    Analyzing --> Success
    Analyzing --> Failed
    Failed --> Retry
    Retry --> Unanalyzed
```

**Sources:** [backend/app/services/db/repositories.py:295-350](), [backend/app/services/db/repositories.py:360-398]()

---

### RagService

`RagService` (not fully shown in provided files but referenced extensively) manages vector embeddings storage and retrieval for semantic search. It interacts with the `all_embeddings` table using pgvector.

#### Inferred Methods

Based on usage patterns in the codebase:

| Method | Purpose | Usage |
|--------|---------|-------|
| `save_embeddings(article_id, chunks)` | Save article embeddings | [backend/app/celery_app/rag_processor.py:239]() |
| `save_repository_embeddings(repo_id, chunks)` | Save repository embeddings | [backend/app/celery_app/repository_tasks.py:383]() |
| `mark_article_rag_processed(article_id, success)` | Update RAG processing status | [backend/app/celery_app/rag_processor.py:146]() |
| `mark_repository_embedding_processed(repo_id, success)` | Update embedding status | [backend/app/celery_app/repository_tasks.py:269]() |
| `search(query_embedding, top_k, feed_id, min_score)` | Vector similarity search | [backend/app/api/routers/rag.py:108-113]() |
| `get_rag_stats()` | Get embedding statistics | [backend/app/api/routers/rag.py:158]() |
| `delete_all_embeddings(article_id)` | Delete embeddings for reindexing | [backend/app/api/routers/rag.py:186]() |
| `reset_article_rag_status(article_id)` | Reset processing flags | [backend/app/api/routers/rag.py:185]() |

#### Embedding Storage Pattern

```mermaid
graph TB
    Content["Article/Repository Content"]
    Parse["Parse + Chunk<br/>chunker.py"]
    Chunks["Text Chunks<br/>(semantic or fallback)"]
    Embed["Generate Embeddings<br/>EmbeddingClient"]
    Vectors["Embedding Vectors<br/>float array"]
    
    Save["RagService.save_embeddings()"]
    Insert["INSERT INTO all_embeddings<br/>(user_id, article_id/repository_id,<br/>chunk_index, content, embedding)"]
    DB[("all_embeddings table<br/>pgvector column")]
    
    Content --> Parse
    Parse --> Chunks
    Chunks --> Embed
    Embed --> Vectors
    Vectors --> Save
    Save --> Insert
    Insert --> DB
```

**Sources:** [backend/app/celery_app/rag_processor.py:87-266](), [backend/app/api/routers/rag.py:83-150]()

---

### Additional Service Classes

#### FeedService

Manages RSS feed subscriptions, refresh intervals, and last fetch status.

**Key Operations:**
- Load user feeds with folder relationships
- Create/update/delete feeds
- Update last_fetched timestamps
- Track fetch success/failure status

**Referenced in:** [backend/app/api/routers/repositories.py:67]()

#### FolderService

Manages folder hierarchy for organizing feeds.

**Key Operations:**
- CRUD operations for folders
- Validate folder name uniqueness
- Handle feed reassignment on folder deletion

**Sources:** [backend/app/api/routers/folders.py:23-159]()

#### SettingsService

Manages user settings including GitHub tokens and preferences.

**Key Operations:**
- Load user settings
- Update settings (encrypted for sensitive fields)
- Validate GitHub token presence

**Sources:** [backend/app/api/routers/repositories.py:67-75]()

#### ApiConfigService

Manages AI API configurations (chat, embedding, rerank).

**Key Operations:**
- Get active configuration by type
- Encrypt/decrypt API keys and base URLs
- Validate configuration completeness

**Referenced in:** [backend/app/api/routers/repositories.py:442]()

#### ArticleRepositoryService

Manages many-to-many relationships between articles and extracted repositories.

**Key Operations:**
- Link repositories to articles
- Query repositories for a given article
- Join with repository details

**Sources:** [backend/app/api/routers/articles.py:199-239]()

---

## Common Patterns and Conventions

### Pattern 1: User Data Isolation

All service methods automatically filter queries by `user_id` to enforce security boundaries:

```mermaid
graph LR
    Service["Service(supabase, user_id)"]
    Query["Execute Query"]
    Filter["Automatically add:<br/>.eq('user_id', self.user_id)"]
    DB[("Database<br/>(multi-tenant)")]
    
    Service --> Query
    Query --> Filter
    Filter --> DB
    
    style Filter fill:#f9f9f9
```

**Example from ArticleService:**
```python
# All queries automatically scoped to user
response = self.supabase.table("articles") \
    .select("*") \
    .eq("user_id", self.user_id) \
    .order("published_at", desc=True) \
    .execute()
```

**Sources:** [backend/app/services/db/articles.py:78-82](), [backend/app/services/db/repositories.py:59-62]()

### Pattern 2: Row-to-Dict Transformation

Services provide private `_row_to_dict()` methods to transform database rows into application-friendly dictionaries:

```mermaid
graph LR
    DBRow["Database Row<br/>(snake_case, db types)"]
    Transform["_row_to_dict()"]
    AppDict["Application Dict<br/>(snake_case, app types)"]
    
    DBRow -->|"Convert types<br/>Handle nulls<br/>Extract nested data"| Transform
    Transform --> AppDict
```

**Example from RepositoryService:**
- Extracts nested arrays (`topics`, `ai_tags`, `ai_platforms`)
- Converts null values to empty arrays
- Preserves timestamp strings
- Maps boolean flags

**Sources:** [backend/app/services/db/repositories.py:485-519]()

### Pattern 3: Status Field Tracking

Services use tri-state flags (NULL/true/false) to track processing stages:

| State | Meaning | Next Action |
|-------|---------|-------------|
| `NULL` | Not yet processed | Schedule processing |
| `true` | Processing succeeded | No action needed |
| `false` | Processing failed | Can retry or skip |

**Article Processing Flags:**
- `images_processed`: Image download/compression complete
- `rag_processed`: Embedding generation complete
- `repos_extracted`: Repository extraction complete

**Repository Processing Flags:**
- `analyzed_at`: AI analysis timestamp (NULL if not done)
- `analysis_failed`: True if AI analysis failed
- `embedding_processed`: README embedding generation status

**Sources:** [backend/app/services/db/articles.py:290-311](), [backend/app/services/db/repositories.py:333-358]()

### Pattern 4: Upsert with Conflict Resolution

Services use Supabase's `upsert()` with `on_conflict` to handle duplicates:

```mermaid
graph TD
    Data["Prepared Rows"]
    Upsert["supabase.table('table').upsert()"]
    Conflict["on_conflict='user_id,unique_field'"]
    Insert{"Row exists?"}
    DoInsert["INSERT new row"]
    DoUpdate["UPDATE existing row"]
    
    Data --> Upsert
    Upsert --> Conflict
    Conflict --> Insert
    Insert -->|No| DoInsert
    Insert -->|Yes| DoUpdate
```

**Examples:**
- **Articles:** `on_conflict="feed_id,content_hash"` - prevents duplicate articles
- **Repositories:** `on_conflict="user_id,github_id"` - prevents duplicate repos per user
- **Folders:** Validates name uniqueness before upsert

**Sources:** [backend/app/services/db/articles.py:54-57](), [backend/app/services/db/repositories.py:182-184]()

### Pattern 5: Static Methods for Celery Tasks

Services provide static methods for use in Celery tasks where full service instantiation isn't needed:

```python
@classmethod
def upsert_repositories_static(
    cls, supabase: Client, user_id: str, repos: List[dict]
) -> dict:
    """Static method for upsert - used by Celery tasks."""
    service = cls(supabase, user_id)
    return service.upsert_repositories(repos)
```

This allows Celery tasks to use service_role client with elevated permissions while maintaining service logic encapsulation.

**Sources:** [backend/app/services/db/repositories.py:21-30]()

---

## Service Dependency Graph

```mermaid
graph TD
    subgraph "API Routers"
        ArticleRouter["/api/articles"]
        RepoRouter["/api/repositories"]
        RagRouter["/api/rag"]
        FeedRouter["/api/feeds"]
        FolderRouter["/api/folders"]
    end
    
    subgraph "Service Layer"
        ArticleService["ArticleService"]
        RepoService["RepositoryService"]
        RagService["RagService"]
        FeedService["FeedService"]
        FolderService["FolderService"]
        SettingsService["SettingsService"]
        ApiConfigService["ApiConfigService"]
        ArticleRepoService["ArticleRepositoryService"]
    end
    
    subgraph "Database Tables"
        Articles["articles"]
        Repos["repositories"]
        Embeddings["all_embeddings"]
        Feeds["feeds"]
        Folders["folders"]
        Settings["settings"]
        ApiConfigs["api_configs"]
        ArticleRepos["article_repositories"]
    end
    
    ArticleRouter --> ArticleService
    ArticleRouter --> ArticleRepoService
    
    RepoRouter --> RepoService
    RepoRouter --> SettingsService
    RepoRouter --> ApiConfigService
    
    RagRouter --> RagService
    RagRouter --> ApiConfigService
    
    FeedRouter --> FeedService
    FolderRouter --> FolderService
    
    ArticleService --> Articles
    ArticleService --> ArticleRepos
    
    RepoService --> Repos
    
    RagService --> Embeddings
    
    FeedService --> Feeds
    FolderService --> Folders
    SettingsService --> Settings
    ApiConfigService --> ApiConfigs
    ArticleRepoService --> ArticleRepos
    ArticleRepoService --> Repos
```

**Sources:** [backend/app/api/routers/articles.py:1-240](), [backend/app/api/routers/repositories.py:1-486](), [backend/app/api/routers/folders.py:1-160]()

---

## Usage in Background Tasks

Service classes are also used extensively in Celery background tasks. Background tasks use the `service_role` Supabase client which has elevated permissions:

```mermaid
graph TB
    Task["Celery Task<br/>(sync_repositories)"]
    GetClient["get_supabase_service()<br/>(service_role client)"]
    Create["RepositoryService(supabase, user_id)"]
    Method["service.upsert_repositories()"]
    
    Task --> GetClient
    GetClient --> Create
    Create --> Method
    
    Note["Note: service_role bypasses<br/>Row Level Security (RLS)<br/>for background processing"]
    
    GetClient -.-> Note
```

**Key Background Task Services:**
- `RepositoryService` - Used in [backend/app/celery_app/repository_tasks.py:51]()
- `RagService` - Used in [backend/app/celery_app/rag_processor.py:123]()
- `ArticleService` - Used in Celery feed refresh tasks

**Sources:** [backend/app/celery_app/repository_tasks.py:50-52](), [backend/app/celery_app/rag_processor.py:122-124]()

---

## Error Handling and Logging

Services follow consistent error handling patterns:

1. **Logging:** All services use Python's `logging` module with structured context
2. **Exceptions:** Let Supabase exceptions bubble up to FastAPI's exception handlers
3. **Validation:** Validate data before database operations
4. **Null Safety:** Handle optional fields and missing data gracefully

**Example logging pattern:**
```python
logger.info(
    f"Upserted {total} repositories",
    extra={'user_id': self.user_id}
)
```

**Sources:** [backend/app/services/db/repositories.py:189-192](), [backend/app/services/db/articles.py:59]()