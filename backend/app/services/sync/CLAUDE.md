# Sync Services Module

Repository synchronization service with clean separation of concerns.

## Structure

```
sync/
├── __init__.py           # Module exports
├── progress.py           # ProgressReporter protocol + SyncPhase enum
├── repository_sync.py    # RepositorySyncService - main orchestration
├── sse_reporter.py       # SSEProgressReporter - SSE implementation
└── CLAUDE.md
```

## Key Components

| Component | Description |
|-----------|-------------|
| `SyncPhase` | Enum: FETCHING, FETCHED, ANALYZING, SAVING, OPENRANK, EMBEDDING, DONE, ERROR |
| `ProgressReporter` | Protocol for progress reporting (SSE, WebSocket, etc.) |
| `SSEProgressReporter` | SSE implementation using asyncio.Queue |
| `RepositorySyncService` | Main sync orchestration (8 phases) |

## Usage

```python
from app.services.sync import RepositorySyncService, SSEProgressReporter

# Create progress reporter
queue = asyncio.Queue()
reporter = SSEProgressReporter(queue)

# Create and run sync service
sync_service = RepositorySyncService(
    supabase=supabase,
    user_id=user_id,
    github_token=github_token,
    progress=reporter,
)
result = await sync_service.sync()
```

## Design Decisions

1. **Progress abstraction**: `ProgressReporter` protocol decouples sync logic from transport
2. **Silent failure**: Optional phases (AI, OpenRank, Embedding) log warnings but don't fail sync
3. **Normalized github_id**: `_normalize_github_id()` eliminates repeated `repo.get("id") or repo.get("github_id")`
