"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useRSSStore } from "@/lib/store"
import { useRealtimeSync } from "@/hooks/use-realtime-sync"
import { DatabaseSetup } from "@/components/database-setup"
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts"
import { Sidebar } from "@/components/sidebar"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/lib/context/auth-context"
import { useTranslations } from "next-intl"

export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common")
  const router = useRouter()
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const { isLoading, error, isDatabaseReady, isSidebarCollapsed, loadFromSupabase, checkDatabaseStatus, setError } = useRSSStore()
  const [isCheckingDatabase, setIsCheckingDatabase] = useState(true)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push("/login")
    }
  }, [isAuthLoading, isAuthenticated, router])

  useRealtimeSync(isAuthenticated)

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

  const loadErrorMessage = t("store.errors.failedToLoadSavedData")

  useEffect(() => {
    if (!isDatabaseReady) {
      return
    }

    const initializeData = async () => {
      try {
        await loadFromSupabase()
      } catch (error) {
        console.error("Failed to initialize data:", error)
        setError(loadErrorMessage)
      }
    }

    initializeData()
  }, [isDatabaseReady, loadFromSupabase, setError, loadErrorMessage])


  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">{t("readerLayout.authenticating")}</p>
        </div>
      </div>
    )
  }

  // Don't render anything if not authenticated (redirecting to login)
  if (!isAuthenticated) {
    return null
  }

  if (isCheckingDatabase) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">{t("readerLayout.checkingDatabaseStatus")}</p>
        </div>
      </div>
    )
  }

  if (!isDatabaseReady) {
    return <DatabaseSetup />
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">{t("readerLayout.loadingRssReader")}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium mb-2">{t("readerLayout.errorLoadingData")}</h3>
          <p className="text-sm text-muted-foreground mb-4 text-pretty">{error}</p>
          <button
            onClick={() => {
              setError(null)
              loadFromSupabase()
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            {t("readerLayout.tryAgain")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-screen bg-background overflow-hidden">
        <div className={`border-r border-border bg-sidebar transition-all duration-300 flex-shrink-0 ${isSidebarCollapsed ? 'w-12' : 'w-64'}`}>
          <Sidebar />
        </div>
        {children}
      </div>
      <KeyboardShortcuts />
    </>
  )
}
