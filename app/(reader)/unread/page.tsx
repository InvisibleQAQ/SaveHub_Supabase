"use client"

import { ArticleList } from "@/components/article-list"
import { ArticlePageLayout } from "@/components/article-page-layout"

export default function UnreadArticlesPage() {
  return (
    <ArticlePageLayout>
      <ArticleList viewMode="unread" />
    </ArticlePageLayout>
  )
}
