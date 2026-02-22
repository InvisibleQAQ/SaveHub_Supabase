"use client"

import { useEffect, useState, useMemo } from "react"
import { RefreshCw, Search, Github, Star, ArrowUp, ArrowDown } from "lucide-react"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { CategorySidebar } from "./category-sidebar"
import { RepositoryCard } from "./repository-card"
import { RepositoryDetailDialog } from "./repository-detail-dialog"
import { getCategoryCounts, filterByCategory, getPlatformCounts, getTagCounts, filterByDynamic } from "@/lib/repository-categories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Repository } from "@/lib/types"
import { useTranslations } from "next-intl"

type SortField = "stars" | "starredAt" | "updatedAt" | "pushedAt" | "name" | "openrank"
type SortDirection = "asc" | "desc"

export function RepositoryPage() {
  const t = useTranslations("repository")
  const { toast } = useToast()

  const {
    repositories,
    isSyncing,
    syncProgress,
    loadRepositories,
    syncRepositories,
    settings,
    isLoading: isStoreLoading,
  } = useRSSStore()

  const [selectedCategory, setSelectedCategory] = useState("all")
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedDynamicFilter, setSelectedDynamicFilter] = useState<{
    type: "platform" | "tag"
    value: string
  } | null>(null)

  // Sort state with localStorage persistence
  const [sortField, setSortField] = useState<SortField>(() => {
    if (typeof window === "undefined") return "stars"
    try {
      const saved = localStorage.getItem("savehub-repo-sort")
      if (saved) return JSON.parse(saved).field || "stars"
    } catch {}
    return "stars"
  })
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    if (typeof window === "undefined") return "desc"
    try {
      const saved = localStorage.getItem("savehub-repo-sort")
      if (saved) return JSON.parse(saved).direction || "desc"
    } catch {}
    return "desc"
  })

  // Load repositories on mount
  useEffect(() => {
    // Skip if store is still loading settings from database
    if (isStoreLoading) {
      return
    }

    const load = async () => {
      if (!settings.githubToken) {
        setIsLoading(false)
        return
      }

      try {
        await loadRepositories()
      } catch (error) {
        console.error("Failed to load repositories:", error)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [isStoreLoading, settings.githubToken, loadRepositories])

  // Persist sort preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("savehub-repo-sort", JSON.stringify({ field: sortField, direction: sortDirection }))
    } catch {}
  }, [sortField, sortDirection])

  // Handle sync
  const handleSync = async () => {
    if (!settings.githubToken) {
      toast({
        title: t("page.tokenMissingTitle"),
        description: t("page.tokenMissingDescription"),
        variant: "destructive",
      })
      return
    }

    try {
      const result = await syncRepositories()
      toast({
        title: t("toast.syncCompletedTitle"),
        description: t("toast.syncCompletedDescription", { total: result.total, newCount: result.newCount }),
      })
    } catch (error) {
      toast({
        title: t("toast.syncFailedTitle"),
        description: error instanceof Error ? error.message : t("toast.unknownError"),
        variant: "destructive",
      })
    }
  }

  // Sort repositories helper function
  const sortRepositories = (repos: Repository[], field: SortField, direction: SortDirection) => {
    return [...repos].sort((a, b) => {
      let cmp = 0
      switch (field) {
        case "stars":
          cmp = a.stargazersCount - b.stargazersCount
          break
        case "starredAt":
          if (!a.starredAt && !b.starredAt) cmp = 0
          else if (!a.starredAt) cmp = 1
          else if (!b.starredAt) cmp = -1
          else cmp = new Date(a.starredAt).getTime() - new Date(b.starredAt).getTime()
          break
        case "updatedAt":
          if (!a.githubUpdatedAt && !b.githubUpdatedAt) cmp = 0
          else if (!a.githubUpdatedAt) cmp = 1
          else if (!b.githubUpdatedAt) cmp = -1
          else cmp = new Date(a.githubUpdatedAt).getTime() - new Date(b.githubUpdatedAt).getTime()
          break
        case "pushedAt":
          if (!a.githubPushedAt && !b.githubPushedAt) cmp = 0
          else if (!a.githubPushedAt) cmp = 1
          else if (!b.githubPushedAt) cmp = -1
          else cmp = new Date(a.githubPushedAt).getTime() - new Date(b.githubPushedAt).getTime()
          break
        case "name":
          cmp = a.name.localeCompare(b.name)
          break
        case "openrank":
          // null values always go to the end, regardless of sort direction
          if (a.openrank === null && b.openrank === null) return 0
          if (a.openrank === null) return 1
          if (b.openrank === null) return -1
          cmp = a.openrank - b.openrank
          break
      }
      return direction === "asc" ? cmp : -cmp
    })
  }

  // Calculate counts and filter
  const counts = useMemo(() => getCategoryCounts(repositories), [repositories])
  const platforms = useMemo(() => getPlatformCounts(repositories), [repositories])
  const tags = useMemo(() => getTagCounts(repositories), [repositories])
  const filteredRepos = useMemo(() => {
    // 动态过滤优先
    let result = selectedDynamicFilter
      ? filterByDynamic(repositories, selectedDynamicFilter.type, selectedDynamicFilter.value)
      : filterByCategory(repositories, selectedCategory)

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (repo) =>
          repo.fullName.toLowerCase().includes(query) ||
          repo.description?.toLowerCase().includes(query) ||
          repo.language?.toLowerCase().includes(query) ||
          repo.topics?.some((t) => t.toLowerCase().includes(query))
      )
    }

    return sortRepositories(result, sortField, sortDirection)
  }, [repositories, selectedCategory, selectedDynamicFilter, searchQuery, sortField, sortDirection])

  // 选择预设分类时，清除动态过滤
  const handleSelectCategory = (id: string) => {
    setSelectedCategory(id)
    setSelectedDynamicFilter(null)
  }

  // 选择动态分类时，重置预设分类为 "all"
  const handleSelectDynamicFilter = (type: "platform" | "tag", value: string) => {
    setSelectedDynamicFilter({ type, value })
    setSelectedCategory("all")
  }

  const handleCardClick = (repo: Repository) => {
    setSelectedRepo(repo)
    setDetailOpen(true)
  }

  // No GitHub token configured (only show after store finished loading)
  if (!settings.githubToken && !isLoading && !isStoreLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4 p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <Github className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">{t("page.tokenMissingTitle")}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t("page.tokenMissingHint")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Category Sidebar */}
      <div className="border-r bg-muted/30 p-4 overflow-y-auto">
        <CategorySidebar
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
          counts={counts}
          platforms={platforms}
          tags={tags}
          selectedDynamicFilter={selectedDynamicFilter}
          onSelectDynamicFilter={handleSelectDynamicFilter}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              <h1 className="text-lg font-semibold">
                {t("page.title")}
              </h1>
            </div>
            <span className="text-sm text-muted-foreground">
              {t("page.repositoryCount", { count: filteredRepos.length })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t("page.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-64 h-9"
              />
            </div>
            <Button
              onClick={handleSync}
              disabled={isSyncing}
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? t("page.syncing") : t("page.sync")}
            </Button>
          </div>
        </div>

        {/* Sort Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b bg-muted/20">
          <Tabs
            value={sortField}
            onValueChange={(v) => setSortField(v as SortField)}
          >
            <TabsList className="h-8 bg-muted/50">
              <TabsTrigger value="stars" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.stars")}
              </TabsTrigger>
              <TabsTrigger value="starredAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.starredAt")}
              </TabsTrigger>
              <TabsTrigger value="updatedAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.updatedAt")}
              </TabsTrigger>
              <TabsTrigger value="pushedAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.pushedAt")}
              </TabsTrigger>
              <TabsTrigger value="name" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.name")}
              </TabsTrigger>
              <TabsTrigger value="openrank" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                {t("sort.openRank")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
            className="gap-1.5 h-8"
          >
            {sortDirection === "asc" ? (
              <>
                <ArrowUp className="w-4 h-4" />
                {t("sort.ascending")}
              </>
            ) : (
              <>
                <ArrowDown className="w-4 h-4" />
                {t("sort.descending")}
              </>
            )}
          </Button>
        </div>

        {/* Sync Progress Bar */}
        {isSyncing && syncProgress && (
          <div className="px-6 py-3 border-b bg-muted/30">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                {syncProgress.phase === "fetching" && t("syncProgress.fetching")}
                {syncProgress.phase === "fetched" && (
                  <>{t("syncProgress.fetched", { total: syncProgress.total ?? 0 })}</>
                )}
                {syncProgress.phase === "analyzing" && (
                  <>{t("syncProgress.analyzing", { current: syncProgress.current ?? "-" })}</>
                )}
                {syncProgress.phase === "saving" && t("syncProgress.saving")}
                {syncProgress.phase === "openrank" && t("syncProgress.openRank")}
                {syncProgress.phase === "embedding" && (
                  <>{t("syncProgress.embedding", { current: syncProgress.current ?? "-" })}</>
                )}
              </span>
              {syncProgress.phase === "analyzing" && syncProgress.completed !== undefined && syncProgress.total !== undefined && (
                <span className="text-muted-foreground">
                  {syncProgress.completed} / {syncProgress.total}
                </span>
              )}
              {syncProgress.phase === "saving" && syncProgress.savedCount !== undefined && syncProgress.saveTotal !== undefined && (
                <span className="text-muted-foreground">
                  {t("syncProgress.savedCount", {
                    savedCount: syncProgress.savedCount,
                    saveTotal: syncProgress.saveTotal,
                  })}
                </span>
              )}
              {syncProgress.phase === "embedding" && syncProgress.completed !== undefined && syncProgress.total !== undefined && (
                <span className="text-muted-foreground">
                  {syncProgress.completed} / {syncProgress.total}
                </span>
              )}
            </div>
            {/* Progress bar for analyzing/saving */}
            {(syncProgress.phase === "analyzing" || syncProgress.phase === "saving") && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{
                    width: `${
                      syncProgress.phase === "analyzing"
                        ? (syncProgress.completed !== undefined && syncProgress.total !== undefined && syncProgress.total > 0
                            ? (syncProgress.completed / syncProgress.total) * 95
                            : 0)
                        : (95 + (syncProgress.savedCount !== undefined && syncProgress.saveTotal !== undefined && syncProgress.saveTotal > 0
                            ? (syncProgress.savedCount / syncProgress.saveTotal) * 5
                            : 0))
                    }%`
                  }}
                />
              </div>
            )}
            {/* Progress bar for embedding */}
            {syncProgress.phase === "embedding" && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300 ease-out"
                  style={{
                    width: `${
                      syncProgress.completed !== undefined && syncProgress.total !== undefined && syncProgress.total > 0
                        ? (syncProgress.completed / syncProgress.total) * 100
                        : 0
                    }%`
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Repository Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">{t("states.loading")}</p>
              </div>
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
                  <Search className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">
                  {repositories.length === 0
                    ? t("states.emptyNoRepository")
                    : searchQuery
                    ? t("states.emptyNoMatch")
                    : t("states.emptyNoCategory")}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredRepos.map((repo) => (
                <RepositoryCard
                  key={repo.id}
                  repository={repo}
                  onClick={() => handleCardClick(repo)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <RepositoryDetailDialog
        repository={selectedRepo}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
