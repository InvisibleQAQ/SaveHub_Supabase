import type { StateCreator } from "zustand"
import type { Article } from "../types"
import { articlesApi } from "../api/articles"
import { computeContentHash } from "../utils/hash"

export interface ArticlesSlice {
  addArticles: (articles: Article[]) => Promise<number>
  markAsRead: (articleId: string) => void
  markAsUnread: (articleId: string) => void
  toggleStar: (articleId: string) => void
  markFeedAsRead: (feedId: string) => void
}

export const createArticlesSlice: StateCreator<
  any,
  [],
  [],
  ArticlesSlice
> = (set, get) => ({
  addArticles: async (articles) => {
    const currentState = get() as any

    // Step 1: ALWAYS compute content hash for all articles
    // This allows users to freely enable/disable deduplication at any time
    const enrichedArticles = await Promise.all(
      articles.map(async (article) => {
        const contentHash = await computeContentHash(article.title, article.content)
        return { ...article, contentHash: contentHash ?? undefined }
      })
    )

    // Step 2: Build deduplication check sets
    const existingUrls = new Set(currentState.articles.map((a: any) => a.url))
    const existingHashes = new Set(
      currentState.articles
        .filter((a: any) => a.contentHash) // Only articles with hash
        .map((a: any) => a.contentHash)
    )

    // Step 3: Filter out duplicates based on feed configuration
    const newArticles = enrichedArticles.filter((article) => {
      // Always check URL duplication
      if (existingUrls.has(article.url)) {
        return false
      }

      // Check content hash duplication ONLY if feed has deduplication enabled
      const feed = currentState.feeds.find((f: any) => f.id === article.feedId)
      if (feed?.enableDeduplication && article.contentHash && existingHashes.has(article.contentHash)) {
        return false
      }

      return true
    })

    if (newArticles.length === 0) {
      return 0
    }

    // Step 4: Update store
    set((state: any) => ({
      articles: [...state.articles, ...newArticles],
    }))

    // Step 5: Persist to database
    articlesApi.saveArticles(newArticles).catch((error) => {
      console.error("Failed to save articles to API:", error)
    })

    return newArticles.length
  },

  markAsRead: (articleId) => {
    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isRead: true } : a)),
    }))

    articlesApi.updateArticle(articleId, { isRead: true }).catch(console.error)
  },

  markAsUnread: (articleId) => {
    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isRead: false } : a)),
    }))

    articlesApi.updateArticle(articleId, { isRead: false }).catch(console.error)
  },

  toggleStar: (articleId) => {
    const state = get() as any
    const article = state.articles.find((a: any) => a.id === articleId)
    if (!article) return

    const newStarredState = !article.isStarred

    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isStarred: newStarredState } : a)),
    }))

    articlesApi.updateArticle(articleId, { isStarred: newStarredState }).catch(console.error)
  },

  markFeedAsRead: (feedId) => {
    const state = get() as any
    const feedArticles = state.articles.filter((a: any) => a.feedId === feedId && !a.isRead)

    if (feedArticles.length === 0) return

    set((state: any) => ({
      articles: state.articles.map((a: any) =>
        a.feedId === feedId && !a.isRead ? { ...a, isRead: true } : a
      ),
    }))

    Promise.all(
      feedArticles.map((article: any) =>
        articlesApi.updateArticle(article.id, { isRead: true })
      )
    ).catch(console.error)
  },
})
