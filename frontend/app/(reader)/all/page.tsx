"use client"

import { ArticleList } from "@/components/article-list"
import { ArticlePageLayout } from "@/components/article-page-layout"

export default function AllArticlesPage() {
  return (
    <ArticlePageLayout>
      <ArticleList viewMode="all" />
    </ArticlePageLayout>
  )
}
