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

type SortField = "stars" | "starredAt" | "updatedAt" | "pushedAt" | "name" | "openrank"
type SortDirection = "asc" | "desc"

export function RepositoryPage() {
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
        title: "GitHub Token 未配置",
        description: "请在设置页面添加 GitHub Token",
        variant: "destructive",
      })
      return
    }

    try {
      const result = await syncRepositories()
      toast({
        title: "同步完成",
        description: `共 ${result.total} 个仓库，新增 ${result.newCount} 个`,
      })
    } catch (error) {
      toast({
        title: "同步失败",
        description: error instanceof Error ? error.message : "未知错误",
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
          // null values go to the end
          if (a.openrank === null && b.openrank === null) cmp = 0
          else if (a.openrank === null) cmp = 1
          else if (b.openrank === null) cmp = -1
          else cmp = a.openrank - b.openrank
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
          <h2 className="text-xl font-semibold">GitHub Token 未配置</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            请在设置页面添加 GitHub Personal Access Token 以同步您的 Starred 仓库
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
                GitHub Stars
              </h1>
            </div>
            <span className="text-sm text-muted-foreground">
              {filteredRepos.length} 个仓库
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="搜索仓库..."
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
              {isSyncing ? "同步中..." : "同步"}
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
                Star 数
              </TabsTrigger>
              <TabsTrigger value="starredAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                收藏时间
              </TabsTrigger>
              <TabsTrigger value="updatedAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                最后更新
              </TabsTrigger>
              <TabsTrigger value="pushedAt" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                最后推送
              </TabsTrigger>
              <TabsTrigger value="name" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                名称
              </TabsTrigger>
              <TabsTrigger value="openrank" className="text-xs px-3 h-7 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium">
                OpenRank
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
                升序
              </>
            ) : (
              <>
                <ArrowDown className="w-4 h-4" />
                降序
              </>
            )}
          </Button>
        </div>

        {/* Sync Progress Bar */}
        {isSyncing && syncProgress && (
          <div className="px-6 py-3 border-b bg-muted/30">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                {syncProgress.phase === "fetching" && "正在获取所有仓库"}
                {syncProgress.phase === "fetched" && (
                  <>获取完成，共 <span className="text-foreground font-medium">{syncProgress.total}</span> 个仓库</>
                )}
                {syncProgress.phase === "analyzing" && (
                  <>正在分析: <span className="text-foreground font-medium">{syncProgress.current}</span></>
                )}
                {syncProgress.phase === "saving" && "正在保存分析结果..."}
              </span>
              {syncProgress.phase === "analyzing" && syncProgress.completed !== undefined && syncProgress.total !== undefined && (
                <span className="text-muted-foreground">
                  {syncProgress.completed} / {syncProgress.total}
                </span>
              )}
              {syncProgress.phase === "saving" && syncProgress.savedCount !== undefined && syncProgress.saveTotal !== undefined && (
                <span className="text-muted-foreground">
                  已保存 {syncProgress.savedCount} / {syncProgress.saveTotal}
                </span>
              )}
            </div>
            {/* Two-phase progress bar: analyzing 0-95%, saving 95-100% */}
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
          </div>
        )}

        {/* Repository Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">加载中...</p>
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
                    ? "暂无仓库，点击同步按钮获取"
                    : searchQuery
                    ? "未找到匹配的仓库"
                    : "该分类下暂无仓库"}
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
