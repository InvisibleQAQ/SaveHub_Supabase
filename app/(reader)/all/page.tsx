"use client"

import { ArticleList } from "@/components/article-list"
import { ArticleContent } from "@/components/article-content"

export default function AllArticlesPage() {
  return (
    <>
      <div className="w-96 border-r border-border bg-card">
        <ArticleList viewMode="all" />
      </div>
      <div className="flex-1 bg-background">
        <ArticleContent />
      </div>
    </>
  )
}
