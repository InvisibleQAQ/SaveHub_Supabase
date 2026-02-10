# Agentic RAG Rules

## Scope
These rules apply to all files under `backend/app/services/agentic_rag/`.

## Config Contract
- Expect `chat_config` and `embedding_config` to be already decrypted and base-url normalized.
- Upstream providers should use `app.services.ai.get_active_config()`.

## Runtime Safety
- Never assume user-provided endpoint URL can be used directly as OpenAI SDK `base_url`.
- If adding a new entrypoint, enforce canonical config loading path before constructing AI clients.
