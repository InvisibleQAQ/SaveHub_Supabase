"use client"

import { ArticleList } from "@/components/article-list"
import { ArticlePageLayout } from "@/components/article-page-layout"

export default function StarredArticlesPage() {
  return (
    <ArticlePageLayout>
      <ArticleList viewMode="starred" />
    </ArticlePageLayout>
  )
}
