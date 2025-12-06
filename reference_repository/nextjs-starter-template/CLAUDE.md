# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chatbot application with Next.js 14 frontend and FastAPI backend. Uses Supabase for authentication, Langchain for LLM orchestration, and real-time streaming responses via Vercel AI SDK.

## Development Commands

### Frontend (Next.js)
```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # Run ESLint
```

### Backend (FastAPI)
```bash
cd backend
poetry install                              # Install dependencies
poetry run uvicorn app.main:app --reload    # Start dev server (localhost:8000)
```

### Docker (Full Stack)
```bash
docker compose up --build    # Start both services
docker compose down          # Stop containers
```

## Architecture

### Monorepo Structure
```
/frontend    # Next.js 14 (App Router, TypeScript)
/backend     # FastAPI + SQLAlchemy + Langchain
```

### Frontend Architecture

**State Management**: React Context API (not Redux/Zustand)
- `AuthContext`: Supabase auth state, JWT token management via `getToken()`
- `ChatSessionContext`: Chat session list, refresh triggers

**Auth Flow**: Supabase handles authentication with JWT tokens
- Middleware (`middleware.ts`) refreshes sessions on each request
- `fetchWithAuth()` utility adds Bearer token to API calls
- Protected routes redirect unauthenticated users

**Chat Implementation**: Vercel AI SDK `useChat` hook
- Connects to FastAPI backend at `NEXT_PUBLIC_CHAT_API/api/sessions/{id}`
- Streaming via `streamProtocol: 'data'` (Vercel AI data stream format)
- Session ID generated client-side (UUID v4) for new chats

**Path Aliases**: `@/*` maps to `./src/*`

### Backend Architecture

**API Structure**: FastAPI with SQLAlchemy ORM
- Single router: `/api/sessions` (CRUD for chat sessions/messages)
- Supabase JWT verification for authentication
- Auto-creates tables on startup via SQLAlchemy metadata

**LLM Processing**: Langchain + OpenAI
- `ChatOpenAI` with streaming enabled
- Simple prompt template in `chat_service.py`
- Streams chunks with `0:"{chunk}\n"` format (Vercel AI SDK compatible)

**Database Schema** (Supabase PostgreSQL):
- `profiles`: Links to `auth.users`, auto-populated via trigger
- `chat_sessions`: User conversations with title, timestamps
- `messages`: Chat messages with role (user/assistant)

### Data Flow

1. User sends message → `useChat` POST to `/api/sessions/{id}`
2. FastAPI validates JWT via Supabase
3. Langchain processes with ChatOpenAI (streaming)
4. Response chunks streamed back with Vercel AI SDK format
5. Message saved to DB in `finally` block (even if streaming interrupted)

## Environment Variables

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_CHAT_API=http://localhost:8000  # Backend URL
```

### Backend (`backend/.env`)
```
OPENAI_API_KEY=
DATABASE_URL=                 # PostgreSQL connection string
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

## Key Files

- `frontend/src/components/chat/Section.tsx`: Main chat UI with `useChat` hook
- `frontend/src/context/AuthContext.tsx`: Auth state and `getToken()` for API calls
- `frontend/src/utils/fetchWithAuth.ts`: Authenticated fetch wrapper
- `backend/app/services/chat_service.py`: LLM streaming logic
- `backend/app/api/routers/chat.py`: Session CRUD endpoints
- `backend/app/dependencies.py`: JWT validation middleware

## Database Setup

1. Create Supabase project
2. Run SQL from `backend/README.md` to create `profiles` table and trigger
3. `chat_sessions` and `messages` tables auto-created on FastAPI startup

## Alternative: Frontend-Only Mode

Can skip FastAPI backend by using Next.js API routes directly:
1. Copy `frontend/src/example/chat.route.ts` to `frontend/src/app/api/chat/route.ts`
2. Change `useChat` api parameter from `${backendUrl}/api/sessions` to `/api/chat`
3. Requires `OPENAI_API_KEY` in frontend env
