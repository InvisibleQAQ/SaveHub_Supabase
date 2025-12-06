"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useRSSStore } from "@/lib/store"

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const {
    articles,
    selectedArticleId,
    setSelectedArticle,
    markAsRead,
    markAsUnread,
    toggleStar,
    getFilteredArticles,
  } = useRSSStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      // Parse current view from pathname
      let viewMode: "all" | "unread" | "starred" = "all"
      let feedId: string | null = null

      if (pathname.startsWith("/feed/")) {
        feedId = pathname.split("/feed/")[1]
      } else if (pathname === "/unread") {
        viewMode = "unread"
      } else if (pathname === "/starred") {
        viewMode = "starred"
      }

      const filteredArticles = getFilteredArticles({ viewMode, feedId })
      const currentIndex = selectedArticleId ? filteredArticles.findIndex((a) => a.id === selectedArticleId) : -1

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault()
          if (filteredArticles.length > 0) {
            const nextIndex = Math.min(currentIndex + 1, filteredArticles.length - 1)
            setSelectedArticle(filteredArticles[nextIndex]?.id || null)
          }
          break

        case "k":
        case "ArrowUp":
          event.preventDefault()
          if (filteredArticles.length > 0) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            setSelectedArticle(filteredArticles[prevIndex]?.id || null)
          }
          break

        case "m":
          event.preventDefault()
          if (selectedArticleId) {
            const article = articles.find((a) => a.id === selectedArticleId)
            if (article) {
              article.isRead ? markAsUnread(selectedArticleId) : markAsRead(selectedArticleId)
            }
          }
          break

        case "s":
          event.preventDefault()
          if (selectedArticleId) {
            toggleStar(selectedArticleId)
          }
          break

        case "o":
        case "Enter":
          event.preventDefault()
          if (selectedArticleId) {
            const article = articles.find((a) => a.id === selectedArticleId)
            if (article) {
              window.open(article.url, "_blank")
            }
          }
          break

        case "1":
          event.preventDefault()
          router.push("/all")
          break

        case "2":
          event.preventDefault()
          router.push("/unread")
          break

        case "3":
          event.preventDefault()
          router.push("/starred")
          break

        case "r":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            // Trigger refresh - this would be handled by the refresh component
            document.dispatchEvent(new CustomEvent("refresh-feeds"))
          }
          break

        case ",":
          event.preventDefault()
          router.push("/settings")
          break
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [articles, selectedArticleId, setSelectedArticle, markAsRead, markAsUnread, toggleStar, getFilteredArticles, router, pathname])

  return null
}
