# AI Services Rules

## Scope
These rules apply to all files under `backend/app/services/ai/`.

## Canonical Config Access (Critical)
- For all OpenAI-compatible runtime flows, use `get_active_config()` or `get_user_ai_configs()` from this module (`app.services.ai`).
- Do not feed `ChatClient`/`EmbeddingClient` with configs from `ApiConfigService.get_active_config()` + manual decrypt.
- Configs passed to clients must be already decrypted and `normalize_base_url()`-processed.

## Base URL Contract
- OpenAI SDK `base_url` must be canonical `.../v1` style.
- Never treat endpoint URLs like `/chat/completions` or `/embeddings` as SDK `base_url`.

## Validation Exception
- `/api-configs/validate` is endpoint validation logic and may use full endpoint URLs directly.
