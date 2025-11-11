// Database types for Supabase
export interface Database {
  public: {
    Tables: {
      folders: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      feeds: {
        Row: {
          id: string
          title: string
          url: string
          description: string | null
          category: string | null
          folder_id: string | null
          unread_count: number
          refresh_interval: number
          last_fetched: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          url: string
          description?: string | null
          category?: string | null
          folder_id?: string | null
          unread_count?: number
          refresh_interval?: number
          last_fetched?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          url?: string
          description?: string | null
          category?: string | null
          folder_id?: string | null
          unread_count?: number
          refresh_interval?: number
          last_fetched?: string | null
          created_at?: string
        }
      }
      articles: {
        Row: {
          id: string
          feed_id: string
          title: string
          content: string
          summary: string | null
          url: string
          author: string | null
          published_at: string
          is_read: boolean
          is_starred: boolean
          thumbnail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          feed_id: string
          title: string
          content: string
          summary?: string | null
          url: string
          author?: string | null
          published_at: string
          is_read?: boolean
          is_starred?: boolean
          thumbnail?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          feed_id?: string
          title?: string
          content?: string
          summary?: string | null
          url?: string
          author?: string | null
          published_at?: string
          is_read?: boolean
          is_starred?: boolean
          thumbnail?: string | null
          created_at?: string
        }
      }
      settings: {
        Row: {
          id: string
          theme: string
          font_size: number
          auto_refresh: boolean
          refresh_interval: number
          articles_retention_days: number
          mark_as_read_on_scroll: boolean
          show_thumbnails: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          theme?: string
          font_size?: number
          auto_refresh?: boolean
          refresh_interval?: number
          articles_retention_days?: number
          mark_as_read_on_scroll?: boolean
          show_thumbnails?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          theme?: string
          font_size?: number
          auto_refresh?: boolean
          refresh_interval?: number
          articles_retention_days?: number
          mark_as_read_on_scroll?: boolean
          show_thumbnails?: boolean
          updated_at?: string
        }
      }
    }
  }
}
