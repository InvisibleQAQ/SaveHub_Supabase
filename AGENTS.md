# Repository Guidelines

## Project Structure & Module Organization
This monorepo has two runtime apps plus documentation:

- `frontend/`: Next.js 14 + TypeScript UI (`app/`, `components/`, `lib/`, `public/`).
- `backend/`: FastAPI + Celery services (`app/api/routers/`, `app/services/`, `app/celery_app/`, `scripts/` for SQL migrations).
- `docs/`: architecture notes, design references, and screenshots.
- Root `package.json`: convenience scripts for running frontend, backend, and workers together.

## Build, Test, and Development Commands
Use `pnpm` from the repository root unless noted.

- `pnpm install:all`: install root/frontend Node deps and backend Python deps.
- `pnpm dev`: start frontend (`:3001`) + backend (`:8000`) concurrently.
- `pnpm dev:celery`: run frontend, backend, and Celery worker.
- `pnpm dev:all`: run frontend, backend, Celery worker, and Flower dashboard.
- `pnpm frontend:build`: production build for the Next.js app.
- `pnpm frontend:lint`: run Next.js ESLint checks.
- `pnpm backend` / `pnpm backend:prod`: start FastAPI in dev/prod mode.

## Coding Style & Naming Conventions
- **TypeScript/React**: 2-space indentation, no semicolons, double quotes, functional components.
- **Python**: PEP 8 style with 4-space indentation; keep modules focused by domain (`services/db`, `services/rag`, etc.).
- Use `PascalCase` for React components, `camelCase` for TS variables/functions, and `snake_case` for Python files/functions.
- Prefer path alias imports in frontend (e.g., `@/components/...`).

## Testing Guidelines
Automated tests are not yet standardized in this repo.

- At minimum, run `pnpm frontend:lint` and perform manual smoke checks for changed flows.
- For backend changes, verify impacted endpoints via `/docs` (Swagger) and relevant worker behavior when applicable.
- If adding tests, place them near the related module (for example, `backend/tests/` or component-adjacent frontend tests) and document how to run them in the PR.

## Commit & Pull Request Guidelines
- Follow the existing conventional style seen in history: `feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `docs: ...`.
- Keep commits focused and atomic; avoid mixing frontend/backend refactors in one commit unless tightly coupled.
- PRs should include: summary, affected areas (`frontend`, `backend`, `scripts`), environment/config changes, and screenshots or API examples for UI/endpoint changes.
- Link related issues/tasks and provide quick verification steps reviewers can run.

## Security & Configuration Tips
- Never commit secrets in `.env` files; use `frontend/.env` and `backend/.env` locally.
- Review SQL scripts in `backend/scripts/` carefully before applying to shared Supabase environments.

## AI Config Usage Rule (Critical)
- For all backend OpenAI-compatible runtime calls, always read active config via `app.services.ai.get_active_config()` (or `get_user_ai_configs()`).
- Do **not** use `ApiConfigService.get_active_config()` + manual `decrypt()` in business routes/services that instantiate `ChatClient`/`EmbeddingClient`.
- Reason: `app.services.ai.get_active_config()` applies both decryption and `normalize_base_url()`; this prevents 404 issues caused by using endpoint URLs (e.g. `/chat/completions`, `/embeddings`) as SDK `base_url`.
- Exception: `/api-configs/validate` is endpoint-validation logic and intentionally uses full endpoint URLs provided by user.
