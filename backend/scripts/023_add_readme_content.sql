-- Add readme_content column to repositories table
-- Stores raw markdown content of repository README files

ALTER TABLE public.repositories
ADD COLUMN IF NOT EXISTS readme_content TEXT;

COMMENT ON COLUMN public.repositories.readme_content IS 'Raw markdown content of repository README file';
