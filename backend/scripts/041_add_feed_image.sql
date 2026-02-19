-- Add feed_image column to store RSS channel image URL
ALTER TABLE public.feeds
ADD COLUMN IF NOT EXISTS feed_image TEXT;
