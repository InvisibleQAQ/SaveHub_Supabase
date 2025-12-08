-- Add unique constraint to folders.name column
-- This prevents duplicate folder names in the system

ALTER TABLE folders
ADD CONSTRAINT folders_name_unique UNIQUE (name);
