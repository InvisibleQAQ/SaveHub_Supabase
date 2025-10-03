import type { StateCreator } from "zustand"
import type { Article } from "../types"
import { dbManager } from "../db"

export interface ArticlesSlice {
  addArticles: (articles: Article[]) => number
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
  addArticles: (articles) => {
    const currentState = get() as any
    const existingUrls = new Set(currentState.articles.map((a: any) => a.url))
    const newArticles = articles.filter((a) => !existingUrls.has(a.url))

    if (newArticles.length === 0) {
      return 0
    }

    set((state: any) => ({
      articles: [...state.articles, ...newArticles],
    }))

    dbManager.saveArticles(newArticles).catch((error) => {
      console.error("Failed to save articles to Supabase:", error)
    })

    return newArticles.length
  },

  markAsRead: (articleId) => {
    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isRead: true } : a)),
    }))

    dbManager.updateArticle(articleId, { isRead: true }).catch(console.error)
  },

  markAsUnread: (articleId) => {
    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isRead: false } : a)),
    }))

    dbManager.updateArticle(articleId, { isRead: false }).catch(console.error)
  },

  toggleStar: (articleId) => {
    const state = get() as any
    const article = state.articles.find((a: any) => a.id === articleId)
    if (!article) return

    const newStarredState = !article.isStarred

    set((state: any) => ({
      articles: state.articles.map((a: any) => (a.id === articleId ? { ...a, isStarred: newStarredState } : a)),
    }))

    dbManager.updateArticle(articleId, { isStarred: newStarredState }).catch(console.error)
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
        dbManager.updateArticle(article.id, { isRead: true })
      )
    ).catch(console.error)
  },
})
