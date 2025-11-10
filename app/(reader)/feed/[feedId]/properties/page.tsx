"use client"

import { EditFeedForm } from "@/components/edit-feed-form"

export default function FeedPropertiesPage({ params }: { params: { feedId: string } }) {
  return (
    <div className="flex-1 bg-background">
      <EditFeedForm feedId={params.feedId} />
    </div>
  )
}
