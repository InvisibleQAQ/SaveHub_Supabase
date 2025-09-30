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
- **[Common Tasks](./docs/06-common-tasks.md)** - Code examples for typical features
- **[Troubleshooting](./docs/07-troubleshooting.md)** - Solutions to common problems

**This file contains quick reference for development. Refer to detailed docs for in-depth explanations.**

---

## Project Overview

RSS Reader built with Next.js 14, React 18, Supabase for data persistence, and Zustand for state management. Uses shadcn/ui components and Radix UI primitives.

## Development Commands

```bash
# Development
pnpm dev          # Start dev server (default: localhost:3000)
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run Next.js linter

# Database
# Run scripts/001_create_tables.sql in Supabase SQL editor to initialize database
```

## Environment Variables

Required in `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Architecture

### Routing Architecture (Next.js App Router)

**URL as Single Source of Truth**: View state (viewMode, feedId) is derived from URL routes, not stored in Zustand.

**Routes**:
- `/` → Redirects to `/all`
- `/all` → All articles
- `/unread` → Unread articles
- `/starred` → Starred articles
- `/feed/[feedId]` → Specific feed's articles

**Shared Layout** (`app/(reader)/layout.tsx`):
- Handles database initialization
- Loads data via `loadFromSupabase()`
- Renders `<Sidebar />` + route-specific content

**Navigation**:
- Sidebar uses `<Link href="/all">` (not `onClick` store updates)
- Keyboard shortcuts use `router.push('/all')` (not `setViewMode`)
- Browser back/forward buttons work natively
- URLs are shareable/bookmarkable

### State Management (Zustand + Supabase)

**Critical Pattern**: Two-layer persistence architecture

1. **Zustand Store** (`lib/store.ts`): Single source of truth for data
   - Holds: folders, feeds, articles
   - **Does NOT hold**: viewMode, selectedFeedId (moved to URL)
   - No localStorage persistence (URL is the persistence)
   - All data mutations go through store actions

2. **Supabase Manager** (`lib/db.ts`): Database persistence layer
   - Handles CRUD operations for Postgres
   - Transforms between app types (Date objects) and DB types (ISO strings)
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

**Supabase Real-time** (`lib/realtime.ts` + `hooks/use-realtime-sync.ts`):
- Subscribes to Postgres changes via Supabase real-time channels
- Listens to INSERT/UPDATE/DELETE on feeds, articles, folders tables
- Updates Zustand store when changes detected from other clients
- Auto-unsubscribes on component unmount

### RSS Feed Processing

**API Routes** (`app/api/rss/`):
- `POST /api/rss/validate`: Validates RSS URL before adding
- `POST /api/rss/parse`: Parses RSS feed using `rss-parser` library, returns feed metadata + articles

**Parser** (`lib/rss-parser.ts`):
- Client-side wrapper for RSS API routes
- `parseRSSFeed()`: Fetches and parses feed, returns typed data
- `validateRSSUrl()`: Pre-validates URL format
- `discoverRSSFeeds()`: Generates common RSS feed URL patterns

### Type System

**Types** (`lib/types.ts`):
- Zod schemas: `FeedSchema`, `ArticleSchema`, `FolderSchema`
- Exported TypeScript types inferred from schemas
- `RSSReaderState`: Complete store state interface

**Database Types** (`lib/supabase/types.ts`):
- Auto-generated from Supabase schema
- Snake_case DB columns (e.g., `feed_id`, `is_read`)
- Transformation functions in `lib/db.ts` convert between camelCase app types and snake_case DB types

### Component Structure

**Route Pages** (`app/(reader)/*/page.tsx`):
- `all/page.tsx`: Renders `<ArticleList viewMode="all" />`
- `unread/page.tsx`: Renders `<ArticleList viewMode="unread" />`
- `starred/page.tsx`: Renders `<ArticleList viewMode="starred" />`
- `feed/[feedId]/page.tsx`: Renders `<ArticleList feedId={params.feedId} />`

**Main Components**:
- `(reader)/layout.tsx`: Root layout with database init + `<Sidebar />`
- `sidebar.tsx`: Feed/folder navigation with `<Link>` components
- `article-list.tsx`: Article list with `viewMode?` and `feedId?` props
- `article-content.tsx`: Article reader with read/star actions
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

> **📖 For implementation examples and code patterns, see [Common Tasks](./docs/06-common-tasks.md)**

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

## Common Patterns

### Adding a New Zustand Action
1. Add action signature to `RSSReaderActions` interface in `lib/store.ts`
2. Implement action in store definition
3. Call `syncToSupabase()` if data should persist
4. Add corresponding `dbManager` method if new DB operation needed

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

---

## 🔗 Quick Links to Detailed Docs

- **Need to understand data flow?** → [Data Flow Guide](./docs/04-data-flow.md)
- **Adding a new feature?** → [Development Guide](./docs/05-development-guide.md) + [Common Tasks](./docs/06-common-tasks.md)
- **Encountering an error?** → [Troubleshooting](./docs/07-troubleshooting.md)
- **Looking for a specific file?** → [File Structure](./docs/03-file-structure.md)
- **Setting up for first time?** → [Getting Started](./docs/01-getting-started.md)