import { createClient } from "./supabase/client"
import type { Database } from "./supabase/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

type FeedRow = Database["public"]["Tables"]["feeds"]["Row"]
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"]
type FolderRow = Database["public"]["Tables"]["folders"]["Row"]

export class RealtimeManager {
  private channels: RealtimeChannel[] = []
  private supabase = createClient()

  subscribeToFeeds(
    onInsert?: (feed: FeedRow) => void,
    onUpdate?: (feed: FeedRow) => void,
    onDelete?: (id: string) => void,
  ) {
    const channel = this.supabase
      .channel("feeds-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "feeds" }, (payload) => {
        console.log("[v0] Real-time feed inserted:", payload.new)
        onInsert?.(payload.new as FeedRow)
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "feeds" }, (payload) => {
        console.log("[v0] Real-time feed updated:", payload.new)
        onUpdate?.(payload.new as FeedRow)
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "feeds" }, (payload) => {
        console.log("[v0] Real-time feed deleted:", payload.old)
        onDelete?.((payload.old as FeedRow).id)
      })
      .subscribe()

    this.channels.push(channel)
    return channel
  }

  subscribeToArticles(
    onInsert?: (article: ArticleRow) => void,
    onUpdate?: (article: ArticleRow) => void,
    onDelete?: (id: string) => void,
  ) {
    const channel = this.supabase
      .channel("articles-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "articles" }, (payload) => {
        console.log("[v0] Real-time article inserted:", payload.new)
        onInsert?.(payload.new as ArticleRow)
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "articles" }, (payload) => {
        console.log("[v0] Real-time article updated:", payload.new)
        onUpdate?.(payload.new as ArticleRow)
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "articles" }, (payload) => {
        console.log("[v0] Real-time article deleted:", payload.old)
        onDelete?.((payload.old as ArticleRow).id)
      })
      .subscribe()

    this.channels.push(channel)
    return channel
  }

  subscribeToFolders(
    onInsert?: (folder: FolderRow) => void,
    onUpdate?: (folder: FolderRow) => void,
    onDelete?: (id: string) => void,
  ) {
    const channel = this.supabase
      .channel("folders-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "folders" }, (payload) => {
        console.log("[v0] Real-time folder inserted:", payload.new)
        onInsert?.(payload.new as FolderRow)
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "folders" }, (payload) => {
        console.log("[v0] Real-time folder updated:", payload.new)
        onUpdate?.(payload.new as FolderRow)
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "folders" }, (payload) => {
        console.log("[v0] Real-time folder deleted:", payload.old)
        onDelete?.((payload.old as FolderRow).id)
      })
      .subscribe()

    this.channels.push(channel)
    return channel
  }

  unsubscribeAll() {
    console.log("[v0] Unsubscribing from all real-time channels")
    this.channels.forEach((channel) => {
      this.supabase.removeChannel(channel)
    })
    this.channels = []
  }
}

export const realtimeManager = new RealtimeManager()
