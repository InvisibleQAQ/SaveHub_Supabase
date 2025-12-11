# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL: File Editing on Windows

### ⚠️ MANDATORY: Always Use Backslashes on Windows for File Paths

**When using Edit or MultiEdit tools on Windows, you MUST use backslashes (`\`) in file paths, NOT forward slashes (`/`).**

#### ❌ WRONG - Will cause errors:
```
Edit(file_path: "D:/repos/project/file.tsx", ...)
MultiEdit(file_path: "D:/repos/project/file.tsx", ...)
```

#### ✅ CORRECT - Always works:
```
Edit(file_path: "D:\repos\project\file.tsx", ...)
MultiEdit(file_path: "D:\repos\project\file.tsx", ...)
```

## 📚 Detailed Documentation

**For comprehensive guides, see the `docs/` directory:**

- **[Getting Started](./docs/01-getting-started.md)** - First-time setup, environment configuration
- **[Architecture](./docs/02-architecture.md)** - System design, data flow, key decisions
- **[File Structure](./docs/03-file-structure.md)** - What each file does, when to modify them
- **[Data Flow](./docs/04-data-flow.md)** - How data moves through the system (7 scenarios)
- **[Development Guide](./docs/05-development-guide.md)** - Development patterns, debugging tips
- **[Common Tasks](./docs/06-common-tasks.md)** - Code examples for basic features
- **[Advanced Tasks](./docs/06-advanced-tasks.md)** - OPML导入导出、阅读统计、拖拽排序等高级特性
- **[Troubleshooting](./docs/07-troubleshooting.md)** - Solutions to common problems

**This file contains quick reference for development. Refer to detailed docs for in-depth explanations.**

---

## Project Overview

RSS Reader built with Next.js 14, React 18, Supabase for data persistence, and Zustand for state management. Uses shadcn/ui components and Radix UI primitives.

## Development Commands

```bash
# Development
pnpm dev          # Start Next.js dev server only (localhost:3000)
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run Next.js linter

# Database
# Run scripts/001_create_tables.sql in Supabase SQL editor to initialize database
```

### Background Job Queue (Celery)

Feed refresh tasks are processed by Celery workers in the FastAPI backend:

```bash
# Terminal 1: FastAPI backend
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2: Celery Worker
cd backend
# Windows:
celery -A app.celery_app worker --loglevel=info --queues=high,default --pool=solo
# Linux/Mac:
celery -A app.celery_app worker --loglevel=info --queues=high,default --concurrency=5

# Terminal 3 (optional): Flower monitoring dashboard
cd backend
celery -A app.celery_app flower --port=5555
```

## Environment Variables

Required in `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
ENCRYPTION_SECRET=your_secret_for_api_key_encryption  # For encrypting API configs
```

Optional WebSocket configuration:
```
NEXT_PUBLIC_FASTAPI_WS_URL=ws://localhost:8000  # Full WebSocket base URL (production)
NEXT_PUBLIC_WS_PORT=8000                         # WebSocket port only (development)
```

**Note on ENCRYPTION_SECRET**: Used by `lib/encryption.ts` to encrypt API keys/bases before storing in database. Currently uses fixed salt (security improvement needed - see Known Issues).

**Note on WebSocket**: Development auto-connects to `ws://localhost:8000/api/ws/realtime`. Production requires either `NEXT_PUBLIC_FASTAPI_WS_URL` or a reverse proxy (nginx) to handle WebSocket upgrade.

## Architecture

### Routing Architecture (Next.js App Router)

**URL as Single Source of Truth**: View state (viewMode, feedId) is derived from URL routes, not stored in Zustand.

**Routes**:
- `/` → Redirects to `/all`
- `/all` → All articles
- `/unread` → Unread articles
- `/starred` → Starred articles
- `/feed/[feedId]` → Specific feed's articles
- `/feed/[feedId]/properties` → **NEW**: Edit feed properties (title, URL, description, category, folder)
- `/settings` → Settings page (redirects to `/settings/general`)
- `/settings/general` → General settings
- `/settings/appearance` → Appearance settings
- `/settings/storage` → Storage settings
- `/settings/api` → **NEW**: API configuration management (OpenAI-compatible APIs, encrypted storage)

**Shared Layout** (`app/(reader)/layout.tsx`):
- Handles database initialization
- Loads data via `loadFromSupabase()`
- Renders `<Sidebar />` + route-specific content

**Navigation**:
- Sidebar uses `<Link href="/all">` (not `onClick` store updates)
- Settings button uses `<Link href="/settings">` (not dialog)
- Keyboard shortcuts use `router.push('/all')` (not `setViewMode`)
- Press `,` key to open settings page
- Browser back/forward buttons work natively
- URLs are shareable/bookmarkable

### State Management (Zustand + Supabase)

**Critical Pattern**: Two-layer persistence architecture

1. **Zustand Store** (`lib/store/index.ts`): Modular slice-based architecture
   - **7 Slices**: DatabaseSlice, FoldersSlice, FeedsSlice, ArticlesSlice, UISlice, SettingsSlice, ApiConfigsSlice
   - Holds: folders, feeds, articles, **apiConfigs** (NEW)
   - **Does NOT hold**: viewMode, selectedFeedId (moved to URL)
   - No localStorage persistence (URL is the persistence for view state)
   - All data mutations go through store actions

2. **Supabase Client** (`lib/supabase/client.ts`): **Singleton pattern** (refactored from factory function)
   - **NEW usage**: `import { supabase } from '@/lib/supabase/client'`
   - **DEPRECATED**: `const supabase = createClient()` (still works but logs warning in dev)
   - Maintains connection pooling efficiency

3. **Database Manager** (`lib/db/*.ts`): Modular persistence layer
   - Split into: `feeds.ts`, `articles.ts`, `folders.ts`, `api-configs.ts`
   - Handles CRUD operations for Postgres
   - Transforms between app types (Date objects) and DB types (ISO strings)
   - **Encryption**: API keys/bases encrypted via `lib/encryption.ts` before storage
   - Called by store actions via `syncToSupabase()` and `loadFromSupabase()`

**Data Flow**:
- User action → Zustand action → Update Zustand state → `syncToSupabase()` → Supabase
- App load → Check `isDatabaseReady` → `loadFromSupabase()` → Populate Zustand state

**Database Initialization**:
- App checks `isDatabaseReady` state before rendering main UI
- If false, shows `DatabaseSetup` component with SQL script instructions
- User must run `scripts/001_create_tables.sql` in Supabase SQL editor

> **📖 For complete data flow scenarios (add feed, mark read, realtime sync, etc.), see [Data Flow Guide](./docs/04-data-flow.md)**

### Real-time Synchronization

**Two implementations available**:

1. **Supabase Real-time** (`lib/realtime.ts`) - DEPRECATED
   - Direct connection to Supabase real-time channels
   - Uses `supabase-js` client

2. **WebSocket via FastAPI** (`lib/realtime-ws.ts`) - NEW
   - Connects to FastAPI WebSocket endpoint `/api/ws/realtime`
   - Cookie-based auth (HttpOnly `sb_access_token`)
   - Auto-reconnect with exponential backoff (1s → 30s max)
   - Heartbeat ping/pong every 30 seconds
   - Drop-in replacement: `realtimeWSManager` has same interface as `realtimeManager`

**Hook** (`hooks/use-realtime-sync.ts`):
- Listens to INSERT/UPDATE/DELETE on feeds, articles, folders tables
- Updates Zustand store when changes detected from other clients
- Auto-unsubscribes on component unmount

**Message format from server**:
```json
{
  "type": "postgres_changes",
  "table": "feeds" | "articles" | "folders",
  "event": "INSERT" | "UPDATE" | "DELETE",
  "payload": { "new": {...}, "old": {...} }
}
```

### RSS Feed Processing

**API Routes** (`app/api/rss/`):
- `POST /api/rss/validate`: Validates RSS URL before adding
- `POST /api/rss/parse`: Parses RSS feed using `rss-parser` library, returns feed metadata + articles

**Parser** (`lib/rss-parser.ts`):
- Client-side wrapper for RSS API routes
- `parseRSSFeed()`: Fetches and parses feed, returns typed data
- `validateRSSUrl()`: Pre-validates URL format
- `discoverRSSFeeds()`: Generates common RSS feed URL patterns

### Background Job Queue (Celery)

**Architecture**: Feed refresh tasks are processed by Celery workers in the FastAPI backend.

**API Endpoints** (via `/api/backend/*` rewrite):
- `POST /api/backend/queue/schedule-feed` - Schedule a feed refresh
- `GET /api/backend/queue-health` - Queue health status
- `GET /api/backend/queue/task/{task_id}` - Task status

**Client** (`lib/queue-client.ts`):
- `scheduleFeedRefresh(feedId, forceImmediate)` - Schedule refresh
- `cancelFeedRefresh(feedId)` - No-op (Celery uses locks for deduplication)
- `getQueueHealth()` - Check queue status

**Celery Features**:
- Task deduplication via Redis locks (3 min TTL)
- Domain rate limiting (1 req/sec per domain)
- Automatic retry with exponential backoff (3 retries)
- Priority queues: `high` (manual refresh), `default` (scheduled)
- Self-rescheduling: tasks automatically schedule next refresh after completion

### Type System

**Types** (`lib/types.ts`):
- Zod schemas: `FeedSchema`, `ArticleSchema`, `FolderSchema`, **`ApiConfigSchema`** (NEW)
- Exported TypeScript types inferred from schemas
- `RSSReaderState`: Complete store state interface

**ApiConfig Type** (NEW):
```typescript
{
  id: string
  name: string
  apiKey: string      // Encrypted in DB
  apiBase: string     // Encrypted in DB
  model: string
  isDefault: boolean
  isActive: boolean
  createdAt: Date
}
```

**Database Types** (`lib/supabase/types.ts`):
- Auto-generated from Supabase schema
- Snake_case DB columns (e.g., `feed_id`, `is_read`, `api_key`, `api_base`)
- Transformation functions in `lib/db/*.ts` convert between camelCase app types and snake_case DB types
- Encryption/decryption handled transparently in `lib/db/api-configs.ts`

### Component Structure

**Shared Page Layouts**:
- **`article-page-layout.tsx`**: 共享布局组件，包含 ArticleList（左侧固定宽度 w-96）+ ArticleContent（右侧自适应）
  - 所有文章列表页面**必须**使用此布局，确保样式一致性
  - 内置 `flex-shrink-0` 防止 Sidebar 动画导致的布局抖动

**Route Pages** (`app/(reader)/*/page.tsx`):
- `all/page.tsx`: `<ArticlePageLayout><ArticleList viewMode="all" /></ArticlePageLayout>`
- `unread/page.tsx`: `<ArticlePageLayout><ArticleList viewMode="unread" /></ArticlePageLayout>`
- `starred/page.tsx`: `<ArticlePageLayout><ArticleList viewMode="starred" /></ArticlePageLayout>`
- `feed/[feedId]/page.tsx`: `<ArticlePageLayout><ArticleList feedId={params.feedId} /></ArticlePageLayout>`
- `feed/[feedId]/properties/page.tsx`: Renders `<EditFeedForm feedId={params.feedId} />` (不使用 ArticlePageLayout)

**Settings Pages** (`app/(reader)/settings/*/page.tsx`):
- `general/page.tsx`: General settings
- `appearance/page.tsx`: Appearance settings
- `storage/page.tsx`: Storage settings
- **`api/page.tsx`** (NEW): API configuration management with encryption support

**Main Components**:
- `(reader)/layout.tsx`: Root layout with database init + `<Sidebar />`
- `sidebar/`: Modular sidebar (10 files, <100 lines each) - refactored from 685-line monolithic component
  - `index.tsx`: Main entry with state management
  - `collapsed-view.tsx` / `expanded-view.tsx`: View components
  - `feed-item.tsx` / `folder-item.tsx`: Reusable atomic components
  - `*-actions-menu.tsx`: Extracted duplicate dropdown menus
- `article-list.tsx`: Article list with `viewMode?` and `feedId?` props
- `article-content.tsx`: Article reader with read/star actions
- **`edit-feed-form.tsx`** (NEW): Feed properties editor with URL validation and duplicate detection
- `keyboard-shortcuts.tsx`: Global keyboard navigation with `router.push()`

**UI Components** (`components/ui/`):
- shadcn/ui components (no modifications needed)
- Import via `@/components/ui/*`

> **📖 For detailed architecture explanation, see [Architecture Guide](./docs/02-architecture.md)**

## Key Implementation Notes

### View State Management
- **View state lives in URL**, not Zustand store
- Components receive `viewMode` and `feedId` as props from route params
- `getFilteredArticles({ viewMode, feedId })` takes parameters instead of reading from store
- Navigation uses `<Link>` and `router.push()`, not store actions

### Date Handling
- **App**: Uses `Date` objects everywhere
- **Database**: Stores as ISO strings (TIMESTAMPTZ in Postgres)
- **Transform**: `toISOString()` helper in `lib/db.ts` safely converts Date → string for DB writes
- **Parse**: DB rows converted back to Date objects in `dbRowTo*()` functions

### Feed Refresh Pattern
```typescript
// Fetch latest articles for a feed
const { articles } = await parseRSSFeed(feed.url, feed.id)
addArticles(articles)  // Zustand action deduplicates by article.id
```

### Unread Count Management
- Not auto-computed from articles
- Stored as `unreadCount` on Feed
- Updated when articles marked read/unread
- Displayed in sidebar badge

### Article Retention
- Settings: `articlesRetentionDays` (default 30)
- `dbManager.clearOldArticles(days)`: Deletes read, non-starred articles older than N days
- Runs on app load after data loaded

### Feed Update Pattern (NEW)
```typescript
// Update feed properties
updateFeed(feedId, { title, url, description, category, folderId })
// → Validates URL if changed
// → Detects duplicate URLs (returns error: 'duplicate')
// → Partial update (only provided fields updated)
// → User-scoped (eq("user_id", userId) ensures security)
```

**Implementation**: `lib/db/feeds.ts:updateFeed()` + `lib/store/feeds.slice.ts:updateFeed()`

### API Configuration Management (NEW)
**Data Flow**:
1. User adds API config (name, apiKey, apiBase)
2. Validates config by calling `{apiBase}/models` endpoint
3. Fetches available models → user selects model
4. Encrypts apiKey + apiBase via AES-GCM (`lib/encryption.ts`)
5. Stores encrypted data in `api_configs` table

**Key Features**:
- Encryption: PBKDF2 (100k iterations) + AES-256-GCM
- Auto-migration: Legacy unencrypted configs auto-upgraded on load
- Default config: Mark one config as default for AI features
- Validation: Real-time API validation with model discovery

**Files**:
- `lib/encryption.ts`: AES-GCM encryption/decryption
- `lib/api-validation.ts`: OpenAI-compatible API validation
- `lib/db/api-configs.ts`: Encrypted persistence
- `lib/store/api-configs.slice.ts`: Store actions

> **📖 For implementation examples and code patterns, see [Common Tasks](./docs/06-common-tasks.md) for basic features and [Advanced Tasks](./docs/06-advanced-tasks.md) for complex functionality**

## Path Aliases

```typescript
"@/*" → "./*"  // Maps to project root
```

## Dependencies to Know

- **Next.js 14**: App Router, Server/Client Components, `<Link>`, `useRouter`, `usePathname`
- **Supabase**: `@supabase/supabase-js` + `@supabase/ssr`
- **Zustand**: State management (no persist middleware - URL is persistence)
- **Radix UI**: Headless UI primitives (via shadcn/ui)
- **Zod**: Runtime type validation
- **rss-parser**: RSS/Atom feed parsing
- **date-fns**: Date formatting utilities
- **Immer**: Used internally by Zustand for immutable updates
- **Pino**: Structured JSON logging (no pino-pretty transport to avoid Next.js hot reload conflicts)

## Common Patterns

### Adding a New Zustand Action
1. Identify the relevant slice in `lib/store/` (e.g., `feeds.slice.ts`, `api-configs.slice.ts`)
2. Add action signature to the slice's interface (e.g., `FeedsSlice`)
3. Implement action in the slice definition
4. Call appropriate `sync*ToSupabase()` method if data should persist
5. Add corresponding method in `lib/db/*.ts` if new DB operation needed
6. Update `lib/store/index.ts` to export new action if needed

### Adding Database Column
1. Update Supabase schema via SQL editor
2. Run `supabase gen types typescript` to regenerate `lib/supabase/types.ts` (if using Supabase CLI)
3. Update Zod schema in `lib/types.ts`
4. Update transform functions in `lib/db.ts` (`dbRowTo*` and insert/upsert mappers)
5. Update store actions if column affects state

### Creating New Dialog Component
- Use `Dialog` from `@/components/ui/dialog`
- Control open state with local `useState` or store
- Use `react-hook-form` + Zod for form validation (see `add-feed-dialog.tsx`)
- Call Zustand actions to persist changes

### Creating New Article List Page
**必须使用 `ArticlePageLayout` 包装**，确保布局一致性和防止抖动：

```tsx
// app/(reader)/your-new-route/page.tsx
"use client"

import { ArticleList } from "@/components/article-list"
import { ArticlePageLayout } from "@/components/article-page-layout"

export default function YourNewPage() {
  return (
    <ArticlePageLayout>
      <ArticleList viewMode="all" /> {/* 或其他 props */}
    </ArticlePageLayout>
  )
}
```

**不要**直接写布局样式（`w-96 border-r` 等），所有样式由 `ArticlePageLayout` 统一管理。

### Logging Pattern
```typescript
import { logger } from "@/lib/logger"

// Info logging with context
logger.info({ userId, feedId, articleCount }, 'Feed refreshed successfully')

// Error logging with stack traces
logger.error({ error, userId, feedId }, 'Feed refresh failed')

// Debug logging (only in development)
logger.debug({ queryParams }, 'Processing request')

// Performance tracking
const startTime = Date.now()
// ... operation ...
const duration = Date.now() - startTime
logger.info({ duration, operationType: 'rss_parse' }, 'Operation completed')
```

**Automatic Features**:
- Sensitive fields auto-redacted (`apiKey`, `password`, `token`)
- Timestamps included in ISO format
- JSON output (works with log aggregators)
- No pino-pretty transport (avoids Next.js hot reload issues)

---

## ⚠️ Known Issues & Technical Debt

**These are NOT bugs - they're design decisions that need improvement. Knowing them helps you avoid making them worse.**

### High Priority

1. **~~API Config Deletion Race Condition~~** ✅ **FIXED** (commit 80d9a8f)
   - Changed from optimistic to pessimistic delete pattern
   - Now deletes from DB first, then updates store only if successful
   - Error handling added with structured logging

2. **Feed Edit Optimistic Update Has No Rollback** (`components/edit-feed-form.tsx`)
   - Store updates immediately via `updateFeed()`
   - If DB operation fails, store and DB are inconsistent
   - **Fix**: Implement rollback on error or use pessimistic updates.

3. **Encryption Uses Fixed Salt** (`lib/encryption.ts:61`)
   ```typescript
   const salt = new TextEncoder().encode("rssreader-salt")  // ❌ Hardcoded
   ```
   **Impact**: Weakens PBKDF2 protection against rainbow table attacks.
   **Fix**: Generate random salt per user, store in `user_metadata` table.

### Medium Priority

4. **Concurrent Feed Edits Cause Overwrites** (`components/edit-feed-form.tsx`)
   - No version/ETag checking
   - If User A and User B edit same feed, last write wins
   - **Fix**: Add `updated_at` column, check version before update.

5. **API Validation Doesn't Distinguish Error Types** (`lib/api-validation.ts`)
   - `getAvailableModels()` returns empty array for both "invalid API" and "network error"
   - Users can't tell if they should retry or fix config
   - **Fix**: Return `{ success: boolean; models?: string[]; error?: 'network' | 'invalid_api' }`.

6. **~~Legacy API Config Migration is Fire-and-Forget~~** ✅ **IMPROVED** (commit 80d9a8f)
   - Now has error logging via Pino structured logger
   - Migration failures are logged with context (configId, userId, error details)
   - Still uses `setTimeout(0)` pattern but no longer silent on failures
   - **Remaining issue**: No retry mechanism for failed migrations

### Low Priority

7. **`any` Types in Store Actions** (`lib/store/feeds.slice.ts`)
   ```typescript
   set((state: any) => ({ ... }))  // ❌ Defeats TypeScript
   ```
   **Impact**: No type safety in store mutations.
   **Fix**: Define proper `WritableDraft<RSSReaderState>` type.

### Design Patterns to Follow

**Good Taste** (keep doing this):
- User-scoped queries: `eq("user_id", userId)` on all DB operations
- Partial updates: Only defined fields updated in `updateFeed()`
- Singleton pattern: Supabase client as module-level export

**Bad Patterns** (avoid these):
- Fire-and-forget async operations without error handling
- Optimistic updates without rollback mechanisms
- Fixed salts or secrets in encryption

---

## 🔗 Quick Links to Detailed Docs

- **Need to understand data flow?** → [Data Flow Guide](./docs/04-data-flow.md)
- **Adding a new feature?** → [Development Guide](./docs/05-development-guide.md) + [Common Tasks](./docs/06-common-tasks.md) + [Advanced Tasks](./docs/06-advanced-tasks.md)
- **Encountering an error?** → [Troubleshooting](./docs/07-troubleshooting.md)
- **Looking for a specific file?** → [File Structure](./docs/03-file-structure.md)
- **Setting up for first time?** → [Getting Started](./docs/01-getting-started.md)