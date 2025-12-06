"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "./sidebar"
import { ArticleList } from "./article-list"
import { ArticleContent } from "./article-content"
import { KeyboardShortcuts } from "./keyboard-shortcuts"
import { DatabaseSetup } from "./database-setup"
import { useRSSStore } from "@/lib/store"
import { useRealtimeSync } from "@/hooks/use-realtime-sync"
import { Loader2 } from "lucide-react"

export function RSSReader() {
  const { isLoading, error, isDatabaseReady, loadFromSupabase, checkDatabaseStatus, setError } = useRSSStore()
  const [isCheckingDatabase, setIsCheckingDatabase] = useState(true)

  useRealtimeSync()

  useEffect(() => {
    const checkDatabase = async () => {
      setIsCheckingDatabase(true)
      try {
        await checkDatabaseStatus()
      } catch (error) {
        console.error("Error checking database:", error)
      } finally {
        setIsCheckingDatabase(false)
      }
    }

    checkDatabase()
  }, [checkDatabaseStatus])

  useEffect(() => {
    if (!isDatabaseReady) {
      return
    }

    const initializeData = async () => {
      try {
        await loadFromSupabase()
      } catch (error) {
        console.error("Failed to initialize data:", error)
        setError("Failed to load saved data")
      }
    }

    initializeData()
  }, [isDatabaseReady, loadFromSupabase, setError])

  useEffect(() => {
    // Listen for custom refresh event
    const handleRefresh = () => {
      document.dispatchEvent(new CustomEvent("refresh-feeds"))
    }

    document.addEventListener("refresh-feeds", handleRefresh)
    return () => document.removeEventListener("refresh-feeds", handleRefresh)
  }, [])

  if (isCheckingDatabase) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking database status...</p>
        </div>
      </div>
    )
  }

  if (!isDatabaseReady) {
    return <DatabaseSetup />
  }

  // Show loading state during initialization
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading RSS Reader...</p>
        </div>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium mb-2">Error Loading Data</h3>
          <p className="text-sm text-muted-foreground mb-4 text-pretty">{error}</p>
          <button
            onClick={() => {
              setError(null)
              loadFromSupabase()
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-screen bg-background">
        {/* Left Panel - Sidebar */}
        <div className="w-80 border-r border-border bg-sidebar">
          <Sidebar />
        </div>

        {/* Middle Panel - Article List */}
        <div className="w-96 border-r border-border bg-card">
          <ArticleList />
        </div>

        {/* Right Panel - Article Content */}
        <div className="flex-1 bg-background">
          <ArticleContent />
        </div>
      </div>

      <KeyboardShortcuts />
    </>
  )
}
