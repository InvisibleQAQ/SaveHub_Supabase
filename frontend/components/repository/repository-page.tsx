"use client"

import { useEffect, useState, useMemo } from "react"
import { RefreshCw, Search, Github, Star } from "lucide-react"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { CategorySidebar } from "./category-sidebar"
import { RepositoryCard } from "./repository-card"
import { RepositoryDetailDialog } from "./repository-detail-dialog"
import { getCategoryCounts, filterByCategory } from "@/lib/repository-categories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Repository } from "@/lib/types"

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

  // Calculate counts and filter
  const counts = useMemo(() => getCategoryCounts(repositories), [repositories])
  const filteredRepos = useMemo(() => {
    let result = filterByCategory(repositories, selectedCategory)

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

    return result
  }, [repositories, selectedCategory, searchQuery])

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
          onSelectCategory={setSelectedCategory}
          counts={counts}
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

        {/* Sync Progress Bar */}
        {isSyncing && syncProgress && (
          <div className="px-6 py-3 border-b bg-muted/30">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                {syncProgress.phase === "fetching" && "正在获取 starred..."}
                {syncProgress.phase === "fetched" && (
                  <>获取完成，共 <span className="text-foreground font-medium">{syncProgress.total}</span> 个仓库</>
                )}
                {syncProgress.phase === "analyzing" && (
                  <>正在分析: <span className="text-foreground font-medium">{syncProgress.current}</span></>
                )}
              </span>
              {syncProgress.phase === "analyzing" && syncProgress.completed !== undefined && syncProgress.total !== undefined && (
                <span className="text-muted-foreground">
                  {syncProgress.completed} / {syncProgress.total}
                </span>
              )}
            </div>
            {syncProgress.phase === "analyzing" && syncProgress.completed !== undefined && syncProgress.total !== undefined && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${(syncProgress.completed / syncProgress.total) * 100}%` }}
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
