# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SaveHub is an RSS reader application with a **monorepo architecture**:
- **Frontend** (`/frontend`): Next.js 14 + React 18 + Supabase + Zustand + shadcn/ui
- **Backend** (`/backend`): FastAPI + Supabase Python SDK
- **Database**: Supabase (PostgreSQL with RLS)

## Development Commands

### Frontend (pnpm)

```bash
cd frontend
pnpm dev          # Next.js dev server (localhost:3000)
pnpm dev:all      # Recommended: Next.js + BullMQ worker + Bull Dashboard
pnpm build        # Production build
pnpm lint         # ESLint
pnpm worker:dev   # BullMQ worker with hot reload
pnpm dashboard    # Bull Dashboard (localhost:5555)
```

### Backend (pip + requirements.txt)

```bash
cd backend
pip install -r requirements.txt             # Install dependencies (base environment)
uvicorn app.main:app --reload               # Dev server (localhost:8000)
# API docs: http://localhost:8000/docs
```

## Architecture

### Monorepo Structure

```
SaveHub_Supabase/
├── frontend/          # Next.js application
│   ├── app/           # App Router pages
│   ├── components/    # React components
│   ├── lib/           # Business logic
│   │   ├── db/        # Supabase CRUD operations
│   │   ├── store/     # Zustand slices (7 slices)
│   │   ├── queue/     # BullMQ job queue
│   │   └── supabase/  # Supabase client
│   └── CLAUDE.md      # Detailed frontend docs
├── backend/           # FastAPI application
│   └── app/
│       ├── api/routers/   # API endpoints
│       ├── schemas/       # Pydantic models
│       └── services/db/   # Database services
└── docs/              # Documentation (reference only)
```

### Key Data Flow

1. **Frontend State**: Zustand store (7 slices) → `syncToSupabase()` → Supabase
2. **Backend API**: FastAPI routes → Pydantic validation → Supabase SDK
3. **Real-time**: Supabase real-time channels → `use-realtime-sync.ts` → Zustand

### URL-Driven Navigation (Frontend)

View state is derived from URL routes, not stored in Zustand:
- `/all`, `/unread`, `/starred` - Article filters
- `/feed/[feedId]` - Single feed view
- `/settings/*` - Settings pages

### Authentication

Both frontend and backend use Supabase JWT:
- Frontend: `@supabase/ssr` for cookie-based sessions
- Backend: `verify_jwt` dependency validates `Authorization: Bearer <token>`

## Environment Variables

### Frontend (`.env`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ENCRYPTION_SECRET=           # For API key encryption
```

### Backend (`.env`)
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # For background tasks (bypasses RLS)
```

## Key Patterns

### Database Operations

- **User-scoped queries**: Always include `.eq("user_id", userId)`
- **Date handling**: App uses `Date` objects; DB uses ISO strings
- **Two client types** (backend): RLS client (user requests) vs Service client (background tasks)

### Adding Features

1. **New Zustand action**: Add to relevant slice in `frontend/lib/store/*.slice.ts`
2. **New DB operation**: Add to `frontend/lib/db/*.ts` or `backend/app/services/db/*.ts`
3. **New API endpoint**: Add router in `backend/app/api/routers/`, register in `main.py`
4. **New page**: Use `ArticlePageLayout` wrapper for article list pages

### Encryption (Frontend)

API keys are encrypted with AES-256-GCM before storage:
- `lib/encryption.ts` handles encrypt/decrypt
- `lib/db/api-configs.ts` applies encryption transparently

## Module-Specific Documentation

- **Frontend details**: See `frontend/CLAUDE.md` for routing, components, state management
- **Database migrations**: See `frontend/scripts/CLAUDE.md` for SQL migration rules
- **Backend schemas**: See `backend/app/schemas/CLAUDE.md` for Pydantic conventions
- **Backend services**: See `backend/app/services/CLAUDE.md` for service layer patterns
