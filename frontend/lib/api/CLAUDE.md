# frontend/lib/api/

Backend API client layer. All HTTP communication with FastAPI backend goes through here.

## Iron Rule: Next.js Rewrite Proxy

All API clients **must** use relative paths through the Next.js rewrite proxy:

```typescript
const API_BASE = "/api/backend/<router-prefix>"
```

The rewrite rule in `next.config.mjs` maps `/api/backend/:path*` → `fastApiUrl/api/:path*`.

**Never** use direct backend URLs (`http://localhost:8000`, `process.env.NEXT_PUBLIC_API_URL`). Direct URLs break cookie passthrough in cross-origin environments and bypass the unified proxy layer.

## File Map

| File | `API_BASE` | Backend Router |
|------|-----------|----------------|
| `auth.ts` | `/api/backend/auth` | `routers/auth.py` |
| `feeds.ts` | `/api/backend/feeds` | `routers/feeds.py` |
| `folders.ts` | `/api/backend/folders` | `routers/folders.py` |
| `articles.ts` | `/api/backend/articles` | `routers/articles.py` |
| `repositories.ts` | `/api/backend/repositories` | `routers/repositories.py` |
| `api-configs.ts` | `/api/backend/api-configs` | `routers/api_configs.py` |
| `settings.ts` | `/api/backend/settings` | `routers/settings.py` |
| `github.ts` | `/api/backend/github` | `routers/github.py` |
| `transcript.ts` | `/api/backend/transcripts` | `routers/transcripts.py` |
| `agentic-rag.ts` | `/api/backend/agentic-rag` | `routers/agentic_rag_chat.py` |

## Auth Pattern

All authenticated requests use `fetchWithAuth()` from `fetch-client.ts`:
- Adds `credentials: "include"` (cookie passthrough)
- Auto-refreshes expired tokens (mutex-locked, single refresh)
- Retries original request after successful refresh
- Redirects to `/login` on refresh 401

SSE streaming clients (`repositories.ts`, `transcript.ts`, `agentic-rag.ts`) call `proactiveRefresh()` before long-running requests.

## Adding a New API Client

1. Create `<name>.ts` in this directory
2. Set `API_BASE = "/api/backend/<router-prefix>"` — must match the backend router's `prefix` in `routers/<name>.py`
3. Use `fetchWithAuth()` for all requests
4. If SSE streaming: call `isTokenExpiringSoon()` + `proactiveRefresh()` before stream start
