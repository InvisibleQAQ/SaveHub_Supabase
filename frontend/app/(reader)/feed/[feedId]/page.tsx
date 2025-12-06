"use client"

import { ArticleList } from "@/components/article-list"
import { ArticlePageLayout } from "@/components/article-page-layout"

export default function FeedArticlesPage({ params }: { params: { feedId: string } }) {
  return (
    <ArticlePageLayout>
      <ArticleList feedId={params.feedId} />
    </ArticlePageLayout>
  )
}
