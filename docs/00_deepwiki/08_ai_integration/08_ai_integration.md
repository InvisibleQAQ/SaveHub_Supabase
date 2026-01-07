
# AI Integration

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [backend/app/api/routers/rag.py](backend/app/api/routers/rag.py)
- [backend/app/api/routers/repositories.py](backend/app/api/routers/repositories.py)
- [backend/app/celery_app/rag_processor.py](backend/app/celery_app/rag_processor.py)
- [backend/app/celery_app/repository_tasks.py](backend/app/celery_app/repository_tasks.py)
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
- [frontend/components/repository/repository-card.tsx](frontend/components/repository/repository-card.tsx)
- [frontend/components/repository/repository-page.tsx](frontend/components/repository/repository-page.tsx)
- [frontend/lib/api/repositories.ts](frontend/lib/api/repositories.ts)
- [frontend/lib/store/repositories.slice.ts](frontend/lib/store/repositories.slice.ts)
- [frontend/lib/types.ts](frontend/lib/types.ts)

</details>



## Overview

This document describes SaveHub's AI integration architecture, which provides flexible multi-provider AI capabilities for content enrichment, semantic search, and intelligent chat features. The system abstracts OpenAI-compatible APIs through a unified service layer, supporting providers like OpenAI, DeepSeek, DashScope, and others.

**Scope**: This page covers AI service configuration, client abstractions, and core AI-powered features. For RAG query endpoints, see [RAG & Search Services](#5.4). For AI chat streaming, see [AI Chat Service](#5.5). For repository synchronization that triggers AI analysis, see [Repository Synchronization](#6.2).

**Key Features**:
- User-configurable API providers with encrypted credential storage
- Unified client abstractions for chat completions, embeddings, and vision
- Repository README analysis for automatic metadata extraction
- Image caption generation for article content
- Semantic embeddings for unified cross-content search

---

## AI Configuration Management

SaveHub allows users to configure multiple AI API providers through the `api_configs` table. Each configuration is encrypted at rest and supports three distinct types: `chat`, `embedding`, and `rerank` (rerank currently reserved for future use).

### Configuration Schema

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner of configuration |
| `name` | String | User-friendly name |
| `type` | Enum | `chat`, `embedding`, or `rerank` |
| `api_key` | Text | Encrypted API key (AES-256-GCM) |
| `api_base` | Text | Encrypted base URL (AES-256-GCM) |
| `model` | String | Model identifier (e.g., `gpt-4o-mini`) |
| `is_active` | Boolean | Only one active config per type allowed |

**Encryption**: Both `api_key` and `api_base` are encrypted using AES-256-GCM before storage. The encryption key is managed via environment variable `ENCRYPTION_KEY`.

### URL Normalization

The system automatically normalizes API base URLs to ensure compatibility with the OpenAI SDK. The normalization logic handles various input formats:

```mermaid
graph LR
    Input["User Input"] --> Normalize["normalize_base_url()"]
    
    Normalize --> Example1["https://api.example.com/v1/chat/completions<br/>→ https://api.example.com/v1"]
    Normalize --> Example2["https://api.example.com/v1/embeddings<br/>→ https://api.example.com/v1"]
    Normalize --> Example3["https://api.example.com<br/>→ https://api.example.com/v1"]
    Normalize --> Example4["api.example.com/v1<br/>→ https://api.example.com/v1"]
    
    Example1 --> SDK["AsyncOpenAI Client"]
    Example2 --> SDK
    Example3 --> SDK
    Example4 --> SDK
```

**Normalization Rules**:
1. Ensure `https://` prefix
2. Remove trailing slashes
3. Strip endpoint suffixes (`/embeddings`, `/chat/completions`, etc.)
4. Append `/v1` if not present

**Sources**: [backend/app/services/ai/config.py:25-75]()

### Configuration Retrieval Flow

```mermaid
graph TD
    API["API Endpoint"] --> GetConfig["get_active_config()"]
    GetConfig --> Query["Supabase Query:<br/>type={type}<br/>is_active=true"]
    Query --> Found{Found?}
    Found -->|Yes| Decrypt["get_decrypted_config()"]
    Found -->|No| Error["Return None"]
    
    Decrypt --> DecryptKey["decrypt(api_key)"]
    Decrypt --> DecryptBase["decrypt(api_base)"]
    DecryptKey --> Normalize["normalize_base_url()"]
    DecryptBase --> Normalize
    
    Normalize --> Return["Return:<br/>{api_key, api_base, model}"]
    
    Return --> CreateClient["ChatClient or<br/>EmbeddingClient"]
```

**Sources**: [backend/app/services/ai/config.py:78-108](), [backend/app/services/ai/config.py:155-190]()

---

## AI Service Clients

The system provides two primary client abstractions: `ChatClient` for language model operations and `EmbeddingClient` for vector generation. Both clients use the `AsyncOpenAI` SDK with unified error handling and retry logic.

### Client Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        ChatClient["ChatClient<br/>- complete()<br/>- stream()<br/>- vision_caption()"]
        EmbedClient["EmbeddingClient<br/>- embed()<br/>- embed_batch()"]
    end
    
    subgraph "SDK Layer"
        OpenAI["AsyncOpenAI<br/>timeout=90s<br/>max_retries=3"]
    end
    
    subgraph "API Providers"
        Provider1["OpenAI"]
        Provider2["DeepSeek"]
        Provider3["DashScope"]
        ProviderN["Other Compatible APIs"]
    end
    
    ChatClient --> OpenAI
    EmbedClient --> OpenAI
    
    OpenAI --> Provider1
    OpenAI --> Provider2
    OpenAI --> Provider3
    OpenAI --> ProviderN
```

**Sources**: [backend/app/services/ai/clients.py:1-17]()

### ChatClient

The `ChatClient` provides three core methods for language model interactions:

| Method | Parameters | Returns | Use Case |
|--------|-----------|---------|----------|
| `complete()` | `messages`, `temperature`, `max_tokens` | `str` | Non-streaming chat completions |
| `stream()` | `messages`, `temperature`, `max_tokens` | `AsyncGenerator[str]` | Streaming chat responses |
| `vision_caption()` | `image_url`, `prompt`, `max_tokens` | `str` | Image description generation |

**Example Usage**:

```python
from app.services.ai import ChatClient

client = ChatClient(
    api_key="...",     # Already decrypted
    api_base="...",    # Already normalized
    model="gpt-4o-mini"
)

# Non-streaming completion
response = await client.complete(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.7,
    max_tokens=2048
)

# Streaming completion
async for chunk in client.stream(messages):
    print(chunk, end="")

# Vision captioning
caption = await client.vision_caption("https://example.com/image.jpg")
```

**Vision Prompt**: The default image captioning prompt is defined in [backend/app/services/ai/clients.py:26-35]() and instructs the model to:
- Describe main elements, scene, and layout
- Extract text if present
- Identify chart types and key information
- Describe code screenshots with language and purpose
- Keep descriptions under 200 characters

**Error Handling**: All methods raise `ChatError` on failure, which includes detailed error chains for debugging.

**Sources**: [backend/app/services/ai/clients.py:53-228]()

### EmbeddingClient

The `EmbeddingClient` generates vector representations for semantic search:

| Method | Parameters | Returns | Purpose |
|--------|-----------|---------|---------|
| `embed()` | `text`, `dimensions` | `List[float]` | Single text embedding |
| `embed_batch()` | `texts`, `dimensions`, `batch_size` | `List[List[float]]` | Batch embedding generation |

**Batch Processing**: `embed_batch()` automatically handles:
- Filtering empty texts while preserving indices
- Splitting large batches into chunks (default 100 per batch)
- Maintaining input-output order correspondence
- Returning empty vectors for invalid texts

**Example Usage**:

```python
from app.services.ai import EmbeddingClient

client = EmbeddingClient(
    api_key="...",
    api_base="...",
    model="text-embedding-3-small"
)

# Single embedding
vector = await client.embed("Hello world", dimensions=1536)

# Batch embeddings
texts = ["Hello", "World", "", "Test"]
vectors = await client.embed_batch(texts, dimensions=1536, batch_size=100)
# Returns 4 vectors: valid embeddings for "Hello", "World", "Test"; empty [] for ""
```

**Sources**: [backend/app/services/ai/clients.py:231-358]()

---

## Repository Analysis

SaveHub uses AI to analyze GitHub repository README files and extract structured metadata: summary, technical tags, and supported platforms. This enables intelligent categorization and search across starred repositories.

### RepositoryAnalyzerService

The `RepositoryAnalyzerService` class orchestrates README analysis using chat completions with structured JSON output parsing.

**Core Methods**:

| Method | Parameters | Returns | Purpose |
|--------|-----------|---------|---------|
| `analyze_repository()` | `readme_content`, `repo_name`, `description` | `dict` | Single repository analysis |
| `analyze_repositories_batch()` | `repos`, `concurrency`, `use_fallback`, `on_progress` | `dict[repo_id, result]` | Batch analysis with progress tracking |
| `fallback_analysis()` | `repo` | `dict` | Rule-based fallback when AI unavailable |

### Analysis Prompt

The system uses a structured prompt to extract metadata in JSON format:

```
You are a professional GitHub repository analyzer. Analyze the following repository's 
README content and extract key information.

Return in JSON format:
1. summary: Brief description in Chinese (50-100 characters)
2. tags: 3-5 technical tags (e.g., React, TypeScript, CLI, API)
3. platforms: Supported platforms (Windows, macOS, Linux, iOS, Android, Web, CLI, Docker)

Only return JSON, no other content. Example:
{
  "summary": "This is a...",
  "tags": ["React", "TypeScript", "UI"],
  "platforms": ["Web", "macOS", "Windows"]
}

If uncertain, use empty arrays or empty strings.
```

**Sources**: [backend/app/services/ai/repository_service.py:46-61]()

### Analysis Workflow

```mermaid
sequenceDiagram
    participant API as "repositories.py"
    participant Service as "RepositoryAnalyzerService"
    participant Chat as "ChatClient"
    participant DB as "RepositoryService"
    
    API->>Service: analyze_repositories_batch(repos)
    
    loop For Each Repository
        Service->>Service: Check readme_content exists
        
        alt Has README
            Service->>Chat: complete(messages)
            Chat-->>Service: JSON response
            Service->>Service: _parse_response()
            Service->>Service: _normalize_platforms()
        else No README or AI Failed
            Service->>Service: fallback_analysis()
            Note over Service: Use language + keywords
        end
        
        Service->>API: on_progress(repo_name, completed, total)
    end
    
    Service-->>API: {repo_id: {success, data, fallback?}}
    
    loop For Each Result
        alt Success
            API->>DB: update_ai_analysis(repo_id, data, is_fallback)
        else Failed
            API->>DB: mark_analysis_failed(repo_id)
        end
    end
```

**Sources**: [backend/app/services/ai/repository_service.py:269-331](), [backend/app/services/repository_analyzer.py:19-103]()

### Fallback Analysis

When AI analysis fails or README is missing, the system uses rule-based inference:

**Language-to-Platform Mapping**:
- JavaScript/TypeScript → Web, CLI
- Python → Linux, macOS, Windows, CLI
- Swift → iOS, macOS
- Kotlin → Android
- Go/Rust → Linux, macOS, Windows, CLI

**Keyword-to-Platform Mapping**:
- "web", "react", "vue" → Web
- "electron", "tauri" → Windows, macOS, Linux
- "docker", "kubernetes" → Docker
- "cli", "terminal" → CLI
- "mobile" → iOS, Android

**Sources**: [backend/app/services/ai/repository_service.py:68-112](), [backend/app/services/ai/repository_service.py:234-267]()

### Integration with Repository Sync

```mermaid
graph TD
    SyncAPI["POST /repositories/sync"] --> FetchStarred["Fetch Starred Repos<br/>from GitHub API"]
    FetchStarred --> FetchREADME["Fetch README Content<br/>for New/Updated Repos"]
    FetchREADME --> Upsert["Upsert to Database"]
    
    Upsert --> GetNeedAnalysis["get_repositories_needing_analysis()"]
    
    GetNeedAnalysis --> Condition{"Has ai_summary?<br/>Has ai_tags?"}
    Condition -->|No| Analyze["analyze_repositories_needing_analysis()"]
    Condition -->|analysis_failed=true| Analyze
    
    Analyze --> GetConfig["get_active_config('chat')"]
    GetConfig --> Found{Config Found?}
    Found -->|No| Skip["Skip Analysis"]
    Found -->|Yes| Batch["analyze_repositories_batch()"]
    
    Batch --> ResetFailed["Reset analysis_failed<br/>for Retry"]
    ResetFailed --> Concurrent["Concurrent Analysis<br/>(concurrency=5)"]
    
    Concurrent --> Success{"Success?"}
    Success -->|Yes| UpdateAI["update_ai_analysis()"]
    Success -->|Fallback| UpdateAI
    Success -->|Failed| MarkFailed["mark_analysis_failed()"]
    
    UpdateAI --> Complete["Analysis Complete"]
    MarkFailed --> Complete
    Skip --> Complete
```

**Triggered By**:
- Manual sync via UI: [backend/app/api/routers/repositories.py:189-196]()
- Automatic Celery task: [backend/app/celery_app/repository_tasks.py:573-581]()

**Sources**: [backend/app/api/routers/repositories.py:166-196](), [backend/app/celery_app/repository_tasks.py:138-164]()

---

## Content Processing (RAG)

AI integration plays a critical role in the RAG (Retrieval-Augmented Generation) pipeline for article content. The system processes articles in stages: image caption generation, semantic chunking, and embedding generation.

### Article RAG Processing Pipeline

```mermaid
graph TD
    Start["Article Created"] --> ImageProc["Image Processing<br/>Complete"]
    ImageProc --> Trigger["process_article_rag<br/>Celery Task"]
    
    Trigger --> GetConfigs["get_user_api_configs()"]
    GetConfigs --> ConfigCheck{Chat & Embedding<br/>Configs Exist?}
    ConfigCheck -->|No| MarkFailed["mark_article_rag_processed(false)"]
    ConfigCheck -->|Yes| ParseHTML["parse_article_content()"]
    
    ParseHTML --> ExtractElements["Extract TextElement<br/>and ImageElement"]
    ExtractElements --> GetImages["Get Image URLs"]
    
    GetImages --> Vision["ChatClient.vision_caption()"]
    Vision --> Captions["Caption Map:<br/>{url: caption}"]
    
    Captions --> FillCaptions["fill_captions()"]
    FillCaptions --> FullText["Generate Full Text<br/>with [图片描述: ...]"]
    
    FullText --> SemanticChunk["chunk_text_semantic()"]
    SemanticChunk --> EmbedBatch["EmbeddingClient.embed_batch()"]
    
    EmbedBatch --> SaveDB["save_embeddings()"]
    SaveDB --> MarkSuccess["mark_article_rag_processed(true)"]
    
    MarkSuccess --> TriggerExtract["extract_article_repos<br/>Celery Task"]
```

**Sources**: [backend/app/celery_app/rag_processor.py:87-267]()

### Image Caption Integration

The system preserves the original order of text and images during content parsing, then generates captions for images and inserts them inline:

**Parsing Flow**:

```mermaid
graph LR
    HTML["Article HTML"] --> Parse["parse_article_content()"]
    Parse --> Elements["ParsedArticle.elements"]
    
    Elements --> Text1["TextElement: paragraph 1"]
    Elements --> Image1["ImageElement: img1.jpg"]
    Elements --> Text2["TextElement: paragraph 2"]
    Elements --> Image2["ImageElement: img2.jpg"]
    Elements --> Text3["TextElement: paragraph 3"]
    
    Image1 --> Vision1["vision_caption(img1.jpg)"]
    Image2 --> Vision2["vision_caption(img2.jpg)"]
    
    Vision1 --> Caption1["caption1"]
    Vision2 --> Caption2["caption2"]
    
    Caption1 --> Fill["fill_captions()"]
    Caption2 --> Fill
    
    Fill --> FullText["Full Text:<br/>paragraph 1<br/>[图片描述: caption1]<br/>paragraph 2<br/>[图片描述: caption2]<br/>paragraph 3"]
```

**Key Design**: Image captions are merged inline with text content **before** semantic chunking, rather than stored as separate chunks. This ensures contextual coherence during retrieval.

**Sources**: [backend/app/services/rag/chunker.py:227-261](), [backend/app/celery_app/rag_processor.py:164-194]()

### Semantic Chunking

The system uses langchain's `SemanticChunker` for intelligent text segmentation based on embedding similarity:

**Chunking Strategy**:

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    api_key=api_key,
    base_url=normalized_base_url,
    model=model,
)

chunker = SemanticChunker(
    embeddings,
    breakpoint_threshold_type="percentile",  # Use percentile threshold
)

docs = chunker.create_documents([text])
chunks = [doc.page_content for doc in docs]
```

**Fallback**: If semantic chunking fails (missing dependencies, API errors), the system falls back to simple character-based chunking with sentence boundary detection.

**Sources**: [backend/app/services/rag/chunker.py:268-329](), [backend/app/services/rag/chunker.py:332-377]()

### Embedding Storage

After chunking, the system generates embeddings for all chunks in batch and stores them in the `all_embeddings` table with pgvector:

| Field | Type | Purpose |
|-------|------|---------|
| `article_id` | UUID | Links to articles table |
| `repository_id` | UUID | Links to repositories table (for repo embeddings) |
| `chunk_index` | Integer | Chunk sequence number |
| `content` | Text | Chunk text content |
| `embedding` | vector(1536) | pgvector embedding |

**Sources**: [backend/app/celery_app/rag_processor.py:227-242]()

---

## Repository Embedding Generation

Similar to article RAG processing, repositories also undergo embedding generation for their README content combined with metadata.

### Repository Embedding Pipeline

```mermaid
graph TD
    Start["Repository Synced"] --> GetRepos["Get Repos Needing Embedding:<br/>embedding_processed IS NULL"]
    GetRepos --> GetConfig["get_user_api_configs()"]
    GetConfig --> ConfigCheck{Embedding<br/>Config Exists?}
    ConfigCheck -->|No| Skip["Skip with Reason"]
    
    ConfigCheck -->|Yes| Loop["For Each Repository"]
    Loop --> BuildText["_build_repository_text()"]
    
    BuildText --> Components["Combine:<br/>- full_name<br/>- description<br/>- topics<br/>- ai_tags<br/>- language<br/>- readme_content<br/>- ai_summary"]
    
    Components --> Chunk["chunk_text_semantic()"]
    Chunk --> FallbackChunk{Success?}
    FallbackChunk -->|No| SimpleChunk["fallback_chunk_text()"]
    FallbackChunk -->|Yes| Embed["embed_texts()"]
    SimpleChunk --> Embed
    
    Embed --> SaveRepoEmbeds["save_repository_embeddings()"]
    SaveRepoEmbeds --> MarkProcessed["mark_repository_embedding_processed(true)"]
    
    MarkProcessed --> Progress["on_progress(repo_name, completed, total)"]
```

**Text Composition**: The system builds a structured text representation for each repository:

```
仓库名称: owner/repo
描述: [description if present]
链接: https://github.com/owner/repo
所有者: owner
标签: topic1, topic2, topic3
AI标签: ai_tag1, ai_tag2
主要语言: [language if present]

README内容:
[readme_content]

AI摘要:
[ai_summary if present]
```

**Sources**: [backend/app/celery_app/repository_tasks.py:205-278](), [backend/app/celery_app/repository_tasks.py:294-323]()

### Integration with Sync Workflow

Repository embedding generation is automatically triggered during repository sync:

```mermaid
sequenceDiagram
    participant API as "POST /repositories/sync"
    participant Sync as "do_sync_repositories()"
    participant AI as "do_ai_analysis()"
    participant OpenRank as "do_openrank_update()"
    participant Embed as "do_repository_embedding()"
    
    API->>Sync: Start Sync
    Sync-->>API: SSE: phase=fetching
    Sync->>Sync: Fetch starred repos from GitHub
    Sync-->>API: SSE: phase=fetched
    Sync->>Sync: Upsert to database
    
    Sync->>AI: Analyze repositories
    AI-->>API: SSE: phase=analyzing
    AI-->>API: SSE: phase=saving
    
    Sync->>OpenRank: Fetch OpenRank scores
    OpenRank-->>API: SSE: phase=openrank
    
    Sync->>Embed: Generate embeddings
    Embed-->>API: SSE: phase=embedding
    Embed->>Embed: on_progress callback
    
    Embed-->>API: SSE: completed
```

**SSE Progress Events**: The sync endpoint streams real-time progress to the frontend:

| Phase | Data | Description |
|-------|------|-------------|
| `fetching` | - | Fetching starred repos from GitHub |
| `fetched` | `total`, `needsReadme` | Fetch complete, README fetching needed |
| `analyzing` | `current`, `completed`, `total` | AI analysis in progress |
| `saving` | `savedCount`, `saveTotal` | Saving analysis results |
| `openrank` | - | Fetching OpenRank scores |
| `embedding` | `current`, `completed`, `total` | Generating embeddings |
| `done` | `total`, `newCount`, `updatedCount` | Sync complete |

**Sources**: [backend/app/api/routers/repositories.py:48-301](), [backend/app/celery_app/repository_tasks.py:216-278]()

---

## Configuration Error Handling

The system handles missing or invalid AI configurations gracefully throughout the processing pipeline:

**Configuration Errors**:

```mermaid
graph TD
    Task["Background Task"] --> GetConfig["get_user_api_configs()"]
    GetConfig --> ChatCheck{Chat Config<br/>Active?}
    ChatCheck -->|No| ConfigError1["Raise ConfigError:<br/>'No active chat config'"]
    ChatCheck -->|Yes| EmbedCheck{Embedding Config<br/>Active?}
    EmbedCheck -->|No| ConfigError2["Raise ConfigError:<br/>'No active embedding config'"]
    
    ConfigError1 --> Catch["Try-Catch in Task"]
    ConfigError2 --> Catch
    
    Catch --> LogWarn["Log Warning:<br/>'Config error for user'"]
    LogWarn --> MarkFailed["Mark Processing Failed"]
    MarkFailed --> Return["Return:<br/>{success: false, error: str(e)}"]
    
    EmbedCheck -->|Yes| Process["Continue Processing"]
```

**Fallback Strategies**:

| Component | Missing Config Behavior |
|-----------|------------------------|
| Repository Analysis | Use `fallback_analysis()` based on language/keywords |
| Article RAG | Mark `rag_processed=false`, skip processing |
| Repository Embeddings | Skip with `{skipped: true, reason: "no_config"}` |

**Sources**: [backend/app/celery_app/rag_processor.py:61-84](), [backend/app/celery_app/repository_tasks.py:232-243]()

---

## Use Case Summary

### Core AI-Powered Features

| Feature | AI Client | Trigger | Output |
|---------|-----------|---------|--------|
| Repository Analysis | ChatClient | Manual sync or Celery task | `ai_summary`, `ai_tags`, `ai_platforms` |
| Image Captioning | ChatClient (vision) | Article RAG processing | Inline captions in full text |
| Article Embeddings | EmbeddingClient | After image processing | Chunks in `all_embeddings` table |
| Repository Embeddings | EmbeddingClient | After AI analysis | Chunks in `all_embeddings` table |
| RAG Query | EmbeddingClient | User search query | Query embedding for similarity search |
| Chat with References | ChatClient | User chat message | Streaming response with citations |

### Data Flow Through AI Services

```mermaid
graph TD
    subgraph "Input Sources"
        GitHub["GitHub Repos<br/>README Content"]
        RSS["RSS Feed Articles<br/>HTML Content"]
        User["User Queries"]
    end
    
    subgraph "AI Processing"
        RepoAnalyzer["RepositoryAnalyzerService<br/>ChatClient.complete()"]
        Vision["ChatClient.vision_caption()"]
        Embedder["EmbeddingClient.embed_batch()"]
    end
    
    subgraph "Storage"
        ReposTable["repositories table<br/>ai_summary, ai_tags, ai_platforms"]
        AllEmbeddings["all_embeddings table<br/>pgvector embeddings"]
    end
    
    subgraph "Retrieval"
        Search["Vector Similarity Search<br/>search_all_embeddings RPC"]
        Chat["Self-RAG Chat<br/>ChatClient.stream()"]
    end
    
    GitHub --> RepoAnalyzer
    RepoAnalyzer --> ReposTable
    
    GitHub --> Embedder
    ReposTable --> Embedder
    
    RSS --> Vision
    Vision --> Embedder
    
    Embedder --> AllEmbeddings
    
    User --> Embedder
    Embedder --> Search
    AllEmbeddings --> Search
    Search --> Chat
```

**Sources**: Multiple files across [backend/app/services/ai/](), [backend/app/celery_app/](), [backend/app/api/routers/]()