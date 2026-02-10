# Services Layer Rules

## Scope
These rules apply to all files under `backend/app/services/`.

## AI Config Rule (Critical)
- For OpenAI-compatible runtime calls, always fetch configs from `app.services.ai.get_active_config()` or `app.services.ai.get_user_ai_configs()`.
- Do not use `ApiConfigService.get_active_config()` + manual decrypt in runtime service flows.
- `get_active_config()` in `app.services.ai` is the canonical path because it does both decryption and `normalize_base_url()`.
- This prevents passing endpoint URLs (like `/chat/completions`, `/embeddings`) as SDK `base_url`, which causes `404 Not Found`.

## Validation Exception
- `/api-configs/validate` is endpoint validation and intentionally accepts full endpoint URLs; keep this behavior unchanged unless explicitly redesigned.
