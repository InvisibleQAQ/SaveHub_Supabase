# Database Schema Documentation

**Last Updated**: 2024
**Database**: PostgreSQL (Supabase)
**Version**: v1.7 (with API configs encryption)

---

## Table of Contents

1. [Overview](#overview)
2. [Core Tables](#core-tables)
   - [folders](#1-folders)
   - [feeds](#2-feeds)
   - [articles](#3-articles)
   - [settings](#4-settings)
   - [api_configs](#5-api_configs)
3. [Data Relationships](#data-relationships)
4. [Indexing Strategy](#indexing-strategy)
5. [Security Model](#security-model)
6. [Migration History](#migration-history)
7. [Design Analysis](#design-analysis)

---

## Overview

**Architecture Pattern**: Multi-tenant SaaS with Row-Level Security (RLS)

**Key Design Decisions**:
- **User Isolation**: Every table has `user_id` foreign key → `auth.users(id)` with `ON DELETE CASCADE`
- **Real-time Sync**: All tables have `created_at` timestamps for change tracking
- **Cascading Deletes**: Maintain referential integrity automatically
- **Encrypted Secrets**: API keys/bases encrypted with AES-256-GCM before storage

**Database Diagram (Simplified)**:
```
auth.users (Supabase Auth)
    ↓ (1:N)
    ├── settings (1:1, user settings)
    ├── api_configs (1:N, encrypted API keys)
    ├── folders (1:N)
    │   └── feeds (1:N via folder_id)
    │       └── articles (1:N via feed_id)
```

---

## Core Tables

### 1. `folders`

**Purpose**: Organize RSS feeds into hierarchical folders (e.g., "Tech News", "Personal Blogs")

**Schema**:
```sql
CREATE TABLE folders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  "order"         INTEGER NOT NULL DEFAULT 0,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT folders_name_unique UNIQUE (name)
);
```

**Columns**:
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `name` | TEXT | NO | - | Folder name (e.g., "Technology") |
| `order` | INTEGER | NO | `0` | Display order in sidebar (manual sorting) |
| `user_id` | UUID | NO | - | Owner of this folder |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Constraints**:
- **UNIQUE**: `folders_name_unique` on `(name)` → Prevents duplicate folder names per system (⚠️ **ISSUE**: Should be per-user, not global)

**Indexes**:
- `idx_folders_user_id` on `(user_id)` → Fast user-scoped queries
- `idx_folders_order` on `("order")` → Fast sorting

**RLS Policy**: `folders_user_isolation` → Users can only access their own folders

**Usage Notes**:
- Feeds can optionally belong to a folder via `feeds.folder_id`
- Deleting a folder sets `feeds.folder_id = NULL` (via `ON DELETE SET NULL`)
- Order field allows drag-and-drop reordering in UI

---

### 2. `feeds`

**Purpose**: Store RSS/Atom feed subscriptions

**Schema**:
```sql
CREATE TABLE feeds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  description       TEXT,
  category          TEXT,
  folder_id         UUID REFERENCES folders(id) ON DELETE SET NULL,
  unread_count      INTEGER NOT NULL DEFAULT 0,
  refresh_interval  INTEGER NOT NULL DEFAULT 60 CHECK (refresh_interval > 0 AND refresh_interval <= 10080),
  last_fetched      TIMESTAMPTZ,
  "order"           INTEGER NOT NULL DEFAULT 0,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT feeds_url_unique UNIQUE (url)
);
```

**Columns**:
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `title` | TEXT | NO | - | Feed title (e.g., "TechCrunch") |
| `url` | TEXT | NO | - | RSS feed URL (must be unique) |
| `description` | TEXT | YES | `NULL` | Feed description/subtitle |
| `category` | TEXT | YES | `NULL` | Feed category tag |
| `folder_id` | UUID | YES | `NULL` | Parent folder (NULL = root level) |
| `unread_count` | INTEGER | NO | `0` | Cached count of unread articles |
| `refresh_interval` | INTEGER | NO | `60` | Auto-refresh interval in minutes (1-10080) |
| `last_fetched` | TIMESTAMPTZ | YES | `NULL` | Last successful fetch timestamp |
| `order` | INTEGER | NO | `0` | Display order within folder |
| `user_id` | UUID | NO | - | Owner of this feed |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Constraints**:
- **UNIQUE**: `feeds_url_unique` on `(url)` → Prevents duplicate feed URLs (⚠️ **ISSUE**: Should be per-user)
- **CHECK**: `refresh_interval > 0 AND refresh_interval <= 10080` → Valid range (1 minute to 1 week)
- **FK**: `folder_id` references `folders(id)` with `ON DELETE SET NULL` (orphaned feeds stay visible)

**Indexes**:
- `idx_feeds_folder_id` on `(folder_id)` → Fast folder-based queries
- `idx_feeds_url` on `(url)` → Fast URL lookups for duplicate detection
- `idx_feeds_last_fetched` on `(last_fetched)` → Identify stale feeds
- `idx_feeds_user_id` on `(user_id)` → User-scoped queries
- `idx_feeds_folder_order` on `(folder_id, "order")` → Efficient sorting within folders

**RLS Policy**: `feeds_user_isolation` → Users can only access their own feeds

**Business Logic**:
- `unread_count` is denormalized for performance (updated when articles marked read/unread)
- `refresh_interval` defaults to 60 minutes but can be customized per feed
- `last_fetched` tracks fetch history for debugging stale feeds

---

### 3. `articles`

**Purpose**: Store parsed articles from RSS feeds

**Schema**:
```sql
CREATE TABLE articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id       UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  summary       TEXT,
  url           TEXT NOT NULL,
  author        TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred    BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail     TEXT,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT articles_feed_url_unique UNIQUE (feed_id, url)
);
```

**Columns**:
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `feed_id` | UUID | NO | - | Parent feed reference |
| `title` | TEXT | NO | - | Article headline |
| `content` | TEXT | NO | - | Full article HTML content |
| `summary` | TEXT | YES | `NULL` | Article excerpt/description |
| `url` | TEXT | NO | - | Original article URL |
| `author` | TEXT | YES | `NULL` | Article author name |
| `published_at` | TIMESTAMPTZ | NO | - | Original publication date |
| `is_read` | BOOLEAN | NO | `FALSE` | Read status flag |
| `is_starred` | BOOLEAN | NO | `FALSE` | Starred/bookmarked flag |
| `thumbnail` | TEXT | YES | `NULL` | Article thumbnail image URL |
| `user_id` | UUID | NO | - | Owner of this article |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | When article was fetched |

**Constraints**:
- **UNIQUE**: `articles_feed_url_unique` on `(feed_id, url)` → Prevents duplicate articles per feed
- **FK**: `feed_id` references `feeds(id)` with `ON DELETE CASCADE` (deleting feed deletes all articles)

**Indexes**:
- `idx_articles_feed_id` on `(feed_id)` → Fast feed-based queries
- `idx_articles_published_at` on `(published_at)` → Sort by publication date
- `idx_articles_is_read` on `(is_read)` → Filter unread articles
- `idx_articles_is_starred` on `(is_starred)` → Filter starred articles
- `idx_articles_feed_published` on `(feed_id, published_at)` → Combined sort/filter
- `idx_articles_url` on `(url)` → Fast URL lookups
- `idx_articles_user_id` on `(user_id)` → User-scoped queries
- `idx_articles_user_feed` on `(user_id, feed_id)` → Optimized user+feed queries

**RLS Policy**: `articles_user_isolation` → Users can only access their own articles

**Performance Notes**:
- Heavy indexing for fast filtering (`is_read`, `is_starred`) and sorting (`published_at`)
- Combined index `(feed_id, published_at)` optimizes common query pattern
- Unique constraint on `(feed_id, url)` enables efficient upsert operations

---

### 4. `settings`

**Purpose**: Store per-user application settings (theme, refresh intervals, etc.)

**Schema**:
```sql
CREATE TABLE settings (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme                   TEXT NOT NULL DEFAULT 'system',
  font_size               INTEGER NOT NULL DEFAULT 16,
  auto_refresh            BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_interval        INTEGER NOT NULL DEFAULT 30,
  articles_retention_days INTEGER NOT NULL DEFAULT 30,
  mark_as_read_on_scroll  BOOLEAN NOT NULL DEFAULT FALSE,
  show_thumbnails         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Columns**:
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `user_id` | UUID | NO | - | Primary key + Foreign key to auth.users |
| `theme` | TEXT | NO | `'system'` | UI theme (`'system'` / `'light'` / `'dark'`) |
| `font_size` | INTEGER | NO | `16` | Article reader font size (px) |
| `auto_refresh` | BOOLEAN | NO | `TRUE` | Enable automatic feed refresh |
| `refresh_interval` | INTEGER | NO | `30` | Global refresh interval (minutes) |
| `articles_retention_days` | INTEGER | NO | `30` | Auto-delete read articles after N days |
| `mark_as_read_on_scroll` | BOOLEAN | NO | `FALSE` | Auto-mark articles as read on scroll |
| `show_thumbnails` | BOOLEAN | NO | `TRUE` | Display article thumbnails |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last settings update |

**Constraints**:
- **PK**: `user_id` serves as primary key (1:1 relationship with users)
- **FK**: `user_id` references `auth.users(id)` with `ON DELETE CASCADE`

**RLS Policy**: `settings_user_isolation` → Users can only access their own settings

**Auto-Initialization**:
```sql
-- Trigger function executed when new user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_user_settings();
```
- New users automatically get default settings via database trigger
- Trigger runs with `SECURITY DEFINER` (elevated privileges) to bypass RLS

---

### 5. `api_configs`

**Purpose**: Store encrypted API configurations for AI features (OpenAI-compatible APIs)

**Schema**:
```sql
CREATE TABLE api_configs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  api_key    TEXT NOT NULL,  -- ⚠️ Encrypted with AES-256-GCM (base64: iv+ciphertext)
  api_base   TEXT NOT NULL,  -- ⚠️ Encrypted with AES-256-GCM (base64: iv+ciphertext)
  model      TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Columns**:
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `name` | TEXT | NO | - | User-friendly config name (e.g., "OpenAI GPT-4") |
| `api_key` | TEXT | NO | - | **Encrypted** API key (AES-GCM, base64-encoded) |
| `api_base` | TEXT | NO | - | **Encrypted** API base URL (AES-GCM, base64-encoded) |
| `model` | TEXT | NO | - | Model identifier (e.g., "gpt-4-turbo") |
| `is_default` | BOOLEAN | NO | `FALSE` | Mark as default config for AI features |
| `is_active` | BOOLEAN | NO | `TRUE` | Enable/disable this config |
| `user_id` | UUID | NO | - | Owner of this config |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Constraints**:
- **UNIQUE INDEX**: `idx_api_configs_single_default` on `(is_default) WHERE is_default = TRUE` → Only one default config per user

**Indexes**:
- `idx_api_configs_is_default` on `(is_default)` → Fast default config lookup
- `idx_api_configs_is_active` on `(is_active)` → Filter active configs
- `idx_api_configs_created_at` on `(created_at)` → Sort by creation date
- `idx_api_configs_user_id` on `(user_id)` → User-scoped queries

**RLS Policy**: `api_configs_user_isolation` → Users can only access their own API configs

**Encryption Details**:
- **Algorithm**: AES-256-GCM with PBKDF2 key derivation (100,000 iterations)
- **Secret**: Derived from `ENCRYPTION_SECRET` environment variable
- **Format**: Base64-encoded string: `<12-byte IV><ciphertext><16-byte auth tag>`
- **Implementation**: `lib/encryption.ts` (client-side encryption before DB write)
- **⚠️ Known Issue**: Uses fixed salt (`"rssreader-salt"`), should be per-user random salt

**Security Notes**:
- Encryption happens in application layer (Next.js API routes), not database
- Supabase never sees plaintext API keys
- Decryption requires valid `ENCRYPTION_SECRET` (environment-specific)

---

## Data Relationships

**Entity Relationship Diagram**:
```
┌─────────────────────┐
│   auth.users        │
│  (Supabase Auth)    │
└──────────┬──────────┘
           │ 1:1
           ↓
    ┌──────────────┐
    │   settings   │ (Auto-created on signup)
    └──────────────┘

           │ 1:N
           ↓
    ┌──────────────┐
    │ api_configs  │ (Encrypted secrets)
    └──────────────┘

           │ 1:N
           ↓
    ┌──────────────┐
    │   folders    │
    └──────┬───────┘
           │ 1:N (nullable)
           ↓
    ┌──────────────┐
    │    feeds     │
    └──────┬───────┘
           │ 1:N
           ↓
    ┌──────────────┐
    │   articles   │
    └──────────────┘
```

**Relationship Rules**:
1. **User → Settings**: 1:1 (auto-created via trigger)
2. **User → API Configs**: 1:N (optional, for AI features)
3. **User → Folders**: 1:N (optional, for organization)
4. **Folder → Feeds**: 1:N (nullable, feeds can be at root level)
5. **Feed → Articles**: 1:N (cascade delete when feed deleted)

**Cascading Delete Behavior**:
```sql
User deleted → ALL data deleted (settings, folders, feeds, articles, api_configs)
Folder deleted → Feeds become orphaned (folder_id = NULL)
Feed deleted → ALL articles deleted
```

---

## Indexing Strategy

**Query Patterns → Index Design**:

| Query Pattern | Index | Rationale |
|---------------|-------|-----------|
| "Show all feeds in folder X" | `(folder_id, "order")` | Composite index for filtering + sorting |
| "Show unread articles" | `(user_id, is_read)` | Filter by user + read status |
| "Show articles from feed X" | `(feed_id, published_at)` | Filter by feed + sort by date |
| "Find stale feeds" | `(last_fetched)` | Identify feeds needing refresh |
| "Get default API config" | `(is_default) WHERE is_default = TRUE` | Partial unique index |
| "Check duplicate article" | `(feed_id, url)` | Unique constraint doubles as index |

**Performance Optimizations**:
- **Covering Indexes**: `idx_articles_feed_published` covers both WHERE and ORDER BY clauses
- **Partial Indexes**: `idx_api_configs_single_default` only indexes `TRUE` values (saves space)
- **Unique Constraints as Indexes**: PostgreSQL automatically creates indexes for UNIQUE constraints

**Index Maintenance**:
- All indexes are `IF NOT EXISTS` → Safe for re-running migrations
- No indexes on low-cardinality columns (e.g., `is_active` alone is not indexed)

---

## Security Model

### Row-Level Security (RLS)

**Enforcement**: Enabled on all tables
```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
```

**Policy Pattern**: User isolation via `auth.uid()`
```sql
CREATE POLICY <table>_user_isolation ON <table>
  FOR ALL
  USING (auth.uid() = user_id);
```

**What This Means**:
- Users can ONLY see/modify rows where `user_id` matches their authenticated user ID
- Applies to SELECT, INSERT, UPDATE, DELETE operations
- Enforced at database level (cannot be bypassed by application code)

**Bypass for System Operations**:
- Database triggers run with `SECURITY DEFINER` (elevated privileges)
- Example: `create_default_user_settings()` can insert into `settings` table on behalf of new users

### Encryption Layer

**What's Encrypted**:
- `api_configs.api_key` (OpenAI/Anthropic API keys)
- `api_configs.api_base` (API endpoint URLs, may contain secrets)

**What's NOT Encrypted**:
- Feed URLs (needed for RSS fetching)
- Article content (needed for full-text search in future)
- User settings (no sensitive data)

**Encryption Flow**:
```
┌─────────────────┐
│  User enters    │
│  API key in UI  │
└────────┬────────┘
         │
         ↓ (HTTPS)
┌─────────────────────┐
│  Next.js API Route  │
│  lib/encryption.ts  │
│  ↓                  │
│  AES-GCM encrypt    │
│  with PBKDF2 key    │
└────────┬────────────┘
         │
         ↓ (Encrypted text)
┌─────────────────────┐
│  Supabase Postgres  │
│  api_configs table  │
│  (stores base64)    │
└─────────────────────┘
```

**Key Derivation**:
```typescript
// Simplified from lib/encryption.ts
const salt = "rssreader-salt" // ⚠️ Fixed salt (security issue)
const keyMaterial = await crypto.subtle.importKey("raw", secretBytes, "PBKDF2", false, ["deriveKey"])
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
  keyMaterial,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"]
)
```

**⚠️ Security Considerations**:
1. **Fixed Salt**: Using hardcoded `"rssreader-salt"` weakens PBKDF2 (should be random per-user)
2. **Client-Side Encryption**: Keys are encrypted in Next.js API routes (server-side), not browser
3. **Secret Rotation**: Changing `ENCRYPTION_SECRET` invalidates all existing encrypted configs
4. **No Backup Key**: Lost `ENCRYPTION_SECRET` = permanent data loss

---

## Migration History

**Chronological Migration Log**:

| Script | Date | Changes | Impact |
|--------|------|---------|--------|
| `001_create_tables.sql` | Initial | Create core tables (`folders`, `feeds`, `articles`, `settings`) | Foundation schema |
| `002_add_order_fields.sql` | v1.1 | Add `order` column to `folders` and `feeds` | Enables drag-and-drop sorting |
| `002_add_refresh_interval.sql` | v1.2 | Add `refresh_interval` to `feeds` (1-10080 minutes) | Per-feed refresh control |
| `003_add_user_authentication.sql` | v1.3 | Add `user_id` to all tables + Enable RLS + Auto-create settings | **BREAKING**: Multi-tenancy enabled |
| `004_add_url_unique_constraint.sql` | v1.4 | Add unique constraint on `articles(feed_id, url)` | Prevents duplicate articles |
| `005_add_folder_name_unique_constraint.sql` | v1.5 | Add unique constraint on `folders(name)` | Prevents duplicate folder names |
| `006_create_api_configs_table.sql` | v1.6 | Create `api_configs` table with encrypted fields | Adds AI integration support |
| `007_add_rls_to_api_configs.sql` | v1.7 | Add `user_id` to `api_configs` + Enable RLS | User isolation for API configs |

**Breaking Changes**:
- **v1.3**: Introduced multi-tenancy. All tables now require `user_id`. Old data without `user_id` will be inaccessible.

**Safe to Run Multiple Times**:
- All migrations use `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`
- Migrations are idempotent (can be re-run without errors)

---

## Design Analysis

### ✅ Good Design Decisions

1. **Data Structure First**
   ```sql
   -- Clean separation: users → folders → feeds → articles
   -- Each layer has clear ownership via foreign keys
   ```
   **Why it's good**: "Bad programmers worry about code. Good programmers worry about data structures." The hierarchical relationship is obvious from the schema.

2. **Cascading Deletes Eliminate Special Cases**
   ```sql
   user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
   ```
   **Why it's good**: No orphaned data. Delete a user? Everything goes automatically. No cleanup jobs needed.

3. **Unique Constraints as Business Rules**
   ```sql
   UNIQUE (feed_id, url)  -- One article per URL per feed
   WHERE is_default = TRUE  -- Only one default API config
   ```
   **Why it's good**: Database enforces business logic. Application code can't accidentally violate rules.

4. **Denormalized `unread_count` for Performance**
   ```sql
   feeds.unread_count INTEGER NOT NULL DEFAULT 0
   ```
   **Why it's good**: Sidebar needs unread counts instantly. Computing `COUNT(*) FROM articles WHERE is_read = FALSE` on every render would kill performance.

5. **Encryption at Application Layer**
   - Database never sees plaintext API keys
   - Supabase admins can't read user secrets
   **Why it's good**: Zero-trust security model. Even if database is compromised, keys are encrypted.

---

### 🔴 Design Issues (Technical Debt)

1. **Global Unique Constraints Break Multi-tenancy**
   ```sql
   -- ❌ BAD: Only one user can have "Technology" folder
   CONSTRAINT folders_name_unique UNIQUE (name)

   -- ❌ BAD: Only one user can subscribe to TechCrunch RSS
   CONSTRAINT feeds_url_unique UNIQUE (url)
   ```
   **The Problem**: These constraints are system-wide, not per-user.
   **Impact**: User A subscribes to `https://example.com/rss` → User B can't subscribe to same feed.
   **Fix**:
   ```sql
   -- ✅ GOOD: Per-user uniqueness
   UNIQUE (user_id, name)  -- folders
   UNIQUE (user_id, url)   -- feeds
   ```

2. **Fixed Salt in Encryption Weakens PBKDF2**
   ```typescript
   // lib/encryption.ts
   const salt = new TextEncoder().encode("rssreader-salt") // ❌ HARDCODED
   ```
   **The Problem**: PBKDF2's job is to slow down brute-force attacks. Fixed salt enables rainbow table attacks.
   **Impact**: If attacker gets database dump + `ENCRYPTION_SECRET`, they can precompute all possible keys.
   **Fix**: Generate random salt per user, store in `user_metadata` table.

3. **No `updated_at` on Mutable Tables**
   ```sql
   -- feeds, articles, folders have created_at but not updated_at
   ```
   **The Problem**: Can't detect concurrent edits (last-write-wins).
   **Impact**: Two users edit same feed → second edit silently overwrites first.
   **Fix**: Add `updated_at TIMESTAMPTZ` + update trigger.

4. **Missing Composite Indexes for Common Queries**
   ```sql
   -- ❌ MISSING: Fast unread count per feed
   CREATE INDEX idx_articles_feed_is_read ON articles(feed_id, is_read);

   -- ❌ MISSING: Fast user+folder queries
   CREATE INDEX idx_feeds_user_folder ON feeds(user_id, folder_id);
   ```
   **Impact**: Queries that filter by multiple columns do sequential scans.

5. **No Soft Deletes**
   ```sql
   -- All deletes are hard deletes (data permanently lost)
   ```
   **The Problem**: Accidental feed deletion = all articles gone forever.
   **Risk**: User clicks "Delete" by mistake → 10,000 articles vanish.
   **Fix**: Add `deleted_at TIMESTAMPTZ` column, filter `WHERE deleted_at IS NULL` in queries.

---

### 💡 Linus-Style Recommendations

**"Fix the data structure, not the code"**:
```sql
-- Instead of adding IF checks for duplicate folders in application code:
-- ❌ BAD CODE:
if (folders.some(f => f.name === newName)) {
  throw new Error("Duplicate folder")
}

-- ✅ GOOD DATABASE:
ALTER TABLE folders ADD CONSTRAINT folders_user_name_unique UNIQUE (user_id, name);
-- Now the database handles it. Code becomes:
try { insertFolder(...) }
catch (error) { if (error.code === '23505') { /* duplicate */ } }
```

**"Complexity is the enemy"**:
- Current schema has 5 tables, 15 indexes, 4 unique constraints, 5 RLS policies
- Each migration adds 1-2 changes max (good taste: incremental evolution)
- No over-engineered "soft delete framework" or "audit log tables" (YAGNI)

**"Never break userspace"**:
- All migrations use `IF NOT EXISTS` → Re-running is safe
- Cascading deletes preserve referential integrity → No broken foreign keys
- RLS policies are additive → Old queries still work

---

## Appendix: Quick Reference

**Add New Table Checklist**:
```sql
CREATE TABLE my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ...
);

CREATE INDEX idx_my_table_user_id ON my_table(user_id);

ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY my_table_user_isolation ON my_table
  FOR ALL
  USING (auth.uid() = user_id);
```

**Verify RLS is Working**:
```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- Check policies exist
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public';
```

**Find Missing Indexes**:
```sql
-- Run EXPLAIN ANALYZE on slow queries
EXPLAIN ANALYZE
SELECT * FROM articles
WHERE user_id = '...' AND feed_id = '...' AND is_read = FALSE
ORDER BY published_at DESC;

-- Look for "Seq Scan" (bad) vs "Index Scan" (good)
```

---

**End of Database Schema Documentation**
