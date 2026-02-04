# Repository Guidelines

## Project Structure & Module Organization
This repo is a monorepo with a Next.js frontend and a FastAPI/Celery backend.
- `frontend/app`: App Router routes (reader views, chat, settings).
- `frontend/components`, `frontend/hooks`, `frontend/lib`: UI, hooks, Zustand store slices, API clients.
- `backend/app/api/routers`: FastAPI endpoints; `backend/app/services`: business logic; `backend/app/celery_app`: background tasks.
- `backend/scripts`: SQL scripts for Supabase migrations (run in Supabase SQL editor).
- `docs/` and `image/`: reference docs and assets.

## Build, Test, and Development Commands
Run these from the repo root unless noted.
- `pnpm install:all`: install root deps, frontend deps, and backend Python deps.
- `pnpm dev`: run frontend (Next.js on `:3001`) and backend (FastAPI on `:8000`) together.
- `pnpm frontend` / `pnpm backend`: run each service individually.
- `pnpm frontend:build`: production build for the frontend.
- `pnpm frontend:lint`: Next.js ESLint checks.
- `pnpm celery`, `pnpm flower`, `pnpm dev:celery`, `pnpm dev:all`: background workers and monitoring.

## Coding Style & Naming Conventions
- TypeScript/TSX uses 2-space indentation, double quotes, and no semicolons; follow existing formatting.
- Python uses 4-space indentation and snake_case; keep Pydantic schemas in `backend/app/schemas`.
- File naming: kebab-case for `frontend/components/*` files, PascalCase for React component names, `*.slice.ts` for Zustand slices.

## Testing Guidelines
Automated tests are minimal and no test scripts are wired in `package.json` yet.
- For new tests, follow the project guide in `docs/00_deepwiki/09_development_guide/09_development_guide.md` (pytest for backend, React Testing Library/Vitest for frontend).
- Until a suite is added, rely on `pnpm frontend:lint` and manual smoke tests (RSS list, repository sync, chat).

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `type(scope): summary` (e.g., `feat(celery): add fallback task`).
- PRs should include a concise summary, linked issues, and screenshots for UI changes. Note any schema/task changes.

## Configuration & Agent Notes
- Backend config lives in `backend/.env` (copy from `backend/.env.example`); set Supabase, Redis, and AI keys.
- If you change code in a directory, update that directory's `CLAUDE.md` per the docs-as-code rule.
