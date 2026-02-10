# Agentic RAG Module Notes

## AI 配置读取规范（关键）

- `agentic_rag` 相关 runtime 调用（问答、检索、改写）创建 `ChatClient` / `EmbeddingClient` 前，必须通过 `app.services.ai.get_active_config()` 获取配置。
- 禁止使用 `ApiConfigService.get_active_config()` + 手动解密作为替代。
- 原因：统一入口会做 `normalize_base_url()`，确保 SDK 使用 `.../v1` 形式 base_url，避免将 `/chat/completions` 或 `/embeddings` 当 base_url 导致 404。

## 边界说明

- 本模块只消费“已解密且已规范化”的配置。
- 如果新增入口路由，请优先在路由层完成统一配置读取，再注入到 `AgenticRagService`。
