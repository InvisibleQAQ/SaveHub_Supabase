"use client"

import { ArticleContent } from "@/components/article-content"

interface ArticlePageLayoutProps {
  children: React.ReactNode
}

/**
 * 共享布局：ArticleList (左侧固定宽度) + ArticleContent (右侧自适应)
 * 所有文章列表页面都应该使用这个布局
 */
export function ArticlePageLayout({ children }: ArticlePageLayoutProps) {
  return (
    <>
      <div className="w-96 flex-shrink-0 border-r border-border bg-card">
        {children}
      </div>
      <div className="flex-1 bg-background">
        <ArticleContent />
      </div>
    </>
  )
}
