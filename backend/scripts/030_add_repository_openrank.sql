ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS openrank FLOAT DEFAULT NULL;

  COMMENT ON COLUMN repositories.openrank IS 'OpenRank score from open-digger';