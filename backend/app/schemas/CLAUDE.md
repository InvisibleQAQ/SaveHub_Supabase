# Schemas Directory

Pydantic schemas for FastAPI request/response validation.

## Files

| File | Purpose |
|------|---------|
| `articles.py` | Article CRUD (create, update, bulk create, stats) |
| `feeds.py` | Feed CRUD with refresh status fields |
| `folders.py` | Folder CRUD with bulk upsert support |
| `settings.py` | User settings (theme, refresh, retention) |
| `api_configs.py` | LLM API configs (encrypted key/base fields) |
| `rss.py` | RSS parsing (validate URL, parse feed/articles) |
| `chat.py` | Chat sessions and LLM message exchange |

## Conventions

- **Base/Create/Update/Response** pattern for CRUD resources
- `snake_case` field names (DB alignment)
- `Optional[T] = None` for partial updates
- `from_attributes = True` for ORM compatibility
