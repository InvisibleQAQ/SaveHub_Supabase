import { z } from "zod"

// Added folder schema
export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date().default(() => new Date()),
})

// Updated feed schema to include folderId
export const FeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional(),
  category: z.string().optional(),
  folderId: z.string().optional(), // Added folderId to organize feeds in folders
  unreadCount: z.number().default(0),
  lastFetched: z.date().optional(),
})

export const ArticleSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string().url(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  thumbnail: z.string().optional(),
})

export type Feed = z.infer<typeof FeedSchema>
export type Article = z.infer<typeof ArticleSchema>
export type Folder = z.infer<typeof FolderSchema>

export interface RSSReaderState {
  folders: Folder[]
  feeds: Feed[]
  articles: Article[]
  selectedArticleId: string | null
  isLoading: boolean
  error: string | null
  searchQuery: string
  isDatabaseReady: boolean
  isSidebarCollapsed: boolean
}
