"use client"

import { useEffect, useState, useMemo } from "react"
import { RefreshCw, AlertCircle } from "lucide-react"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { CategorySidebar } from "./category-sidebar"
import { RepositoryCard } from "./repository-card"
import { getCategoryCounts, filterByCategory } from "@/lib/repository-categories"
import { Button } from "@/components/ui/button"

export function RepositoryPage() {
  const { toast } = useToast()

  const {
    repositories,
    isSyncing,
    loadRepositories,
    syncRepositories,
    settings,
  } = useRSSStore()

  const [selectedCategory, setSelectedCategory] = useState("all")
  const [isLoading, setIsLoading] = useState(true)

  // Load repositories on mount
  useEffect(() => {
    const load = async () => {
      if (!settings.githubToken) {
        toast({
          title: "GitHub Token 未配置",
          description: "请在设置页面添加 GitHub Token",
          variant: "destructive",
        })
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
  }, [settings.githubToken, loadRepositories, toast])

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
  const filteredRepos = useMemo(
    () => filterByCategory(repositories, selectedCategory),
    [repositories, selectedCategory]
  )

  // No GitHub token configured
  if (!settings.githubToken && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-medium">GitHub Token 未配置</h2>
          <p className="text-sm text-muted-foreground">
            请在设置页面添加 GitHub Personal Access Token
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Category Sidebar */}
      <div className="border-r p-4 overflow-y-auto">
        <CategorySidebar
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          counts={counts}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h1 className="text-lg font-medium">
            GitHub Stars ({filteredRepos.length})
          </h1>
          <Button
            onClick={handleSync}
            disabled={isSyncing}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "同步中..." : "同步"}
          </Button>
        </div>

        {/* Repository Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">
                {repositories.length === 0
                  ? "暂无仓库，点击同步按钮获取"
                  : "该分类下暂无仓库"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredRepos.map((repo) => (
                <RepositoryCard key={repo.id} repository={repo} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
