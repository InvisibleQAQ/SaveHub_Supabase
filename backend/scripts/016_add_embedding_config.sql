-- Add embedding configuration fields to api_configs table
-- These fields are separate from chat model config (api_key, api_base, model)
-- All three fields are required for semantic search functionality

-- Embedding API key (encrypted using same AES-GCM as api_key)
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_api_key TEXT;

-- Embedding API base URL (e.g., https://api.openai.com/v1)
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_api_base TEXT;

-- Embedding model name (e.g., text-embedding-3-large)
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- Note: All three fields must be configured for semantic search to work.
-- If any field is NULL, the embedding/search features will be unavailable.
