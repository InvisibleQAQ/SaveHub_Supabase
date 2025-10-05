-- Create API configurations table
-- This table stores user's API configurations with encrypted sensitive data
CREATE TABLE IF NOT EXISTS api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key TEXT NOT NULL, -- Encrypted using AES-GCM
  api_base TEXT NOT NULL, -- Encrypted using AES-GCM
  model TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_api_configs_is_default ON api_configs(is_default);
CREATE INDEX IF NOT EXISTS idx_api_configs_is_active ON api_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_api_configs_created_at ON api_configs(created_at);

-- Ensure only one default config at a time (optional constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_configs_single_default
ON api_configs(is_default)
WHERE is_default = TRUE;