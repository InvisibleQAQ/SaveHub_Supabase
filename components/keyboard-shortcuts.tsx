"use client"

import { useEffect } from "react"
import { useRSSStore } from "@/lib/store"

export function KeyboardShortcuts() {
  const {
    articles,
    selectedArticleId,
    setSelectedArticle,
    markAsRead,
    markAsUnread,
    toggleStar,
    getFilteredArticles,
    setViewMode,
    viewMode,
  } = useRSSStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const filteredArticles = getFilteredArticles()
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
          setViewMode("all")
          break

        case "2":
          event.preventDefault()
          setViewMode("unread")
          break

        case "3":
          event.preventDefault()
          setViewMode("starred")
          break

        case "r":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            // Trigger refresh - this would be handled by the refresh component
            document.dispatchEvent(new CustomEvent("refresh-feeds"))
          }
          break
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [
    articles,
    selectedArticleId,
    setSelectedArticle,
    markAsRead,
    markAsUnread,
    toggleStar,
    getFilteredArticles,
    setViewMode,
    viewMode,
  ])

  return null
}
