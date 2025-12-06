# 前端展示

本文档详细介绍 Glean 前端如何获取和展示 RSS Feed 内容。

## 技术栈

- **React 18**: UI 框架
- **TanStack Query**: 数据获取和缓存
- **Zustand**: 状态管理
- **Tailwind CSS**: 样式
- **Vite**: 构建工具

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Components                          │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ ReaderPage  │  │ SubscriptionsPage│ │   ArticleReader    │  │
│  └──────┬──────┘  └────────┬────────┘  └──────────┬──────────┘  │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TanStack Query Hooks                        │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ useEntries  │  │ useSubscriptions │  │  useUpdateEntry    │  │
│  └──────┬──────┘  └────────┬────────┘  └──────────┬──────────┘  │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Client Services                         │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ EntryService│  │   FeedService   │  │   FolderService    │  │
│  └──────┬──────┘  └────────┬────────┘  └──────────┬──────────┘  │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
          └──────────────────┼─────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │   REST API      │
                    │ /api/feeds      │
                    │ /api/entries    │
                    └─────────────────┘
```

## API Client 服务

### FeedService

**文件路径**: `frontend/packages/api-client/src/services/feeds.ts`

```typescript
import { apiClient } from '../client';
import type { SubscriptionResponse } from '@glean/types';

export class FeedService {
  /**
   * 获取用户订阅列表
   */
  static async getSubscriptions(folderId?: string): Promise<SubscriptionResponse[]> {
    const params = folderId !== undefined ? { folder_id: folderId } : {};
    const response = await apiClient.get('/api/feeds', { params });
    return response.data;
  }

  /**
   * 发现并订阅 Feed
   */
  static async discoverFeed(url: string, folderId?: string): Promise<SubscriptionResponse> {
    const response = await apiClient.post('/api/feeds/discover', { url, folder_id: folderId });
    return response.data;
  }

  /**
   * 更新订阅设置
   */
  static async updateSubscription(
    id: string,
    data: { custom_title?: string; folder_id?: string | null; feed_url?: string }
  ): Promise<SubscriptionResponse> {
    const response = await apiClient.patch(`/api/feeds/${id}`, data);
    return response.data;
  }

  /**
   * 删除订阅
   */
  static async deleteSubscription(id: string): Promise<void> {
    await apiClient.delete(`/api/feeds/${id}`);
  }

  /**
   * 批量删除订阅
   */
  static async batchDeleteSubscriptions(ids: string[]): Promise<{ deleted_count: number; failed_count: number }> {
    const response = await apiClient.post('/api/feeds/batch-delete', { subscription_ids: ids });
    return response.data;
  }

  /**
   * 手动刷新单个 Feed
   */
  static async refreshFeed(subscriptionId: string): Promise<{ status: string; job_id: string }> {
    const response = await apiClient.post(`/api/feeds/${subscriptionId}/refresh`);
    return response.data;
  }

  /**
   * 刷新所有 Feed
   */
  static async refreshAllFeeds(): Promise<{ status: string; queued_count: number }> {
    const response = await apiClient.post('/api/feeds/refresh-all');
    return response.data;
  }

  /**
   * 导入 OPML
   */
  static async importOPML(file: File): Promise<{ success: number; failed: number; total: number }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/api/feeds/import', formData);
    return response.data;
  }

  /**
   * 导出 OPML
   */
  static async exportOPML(): Promise<Blob> {
    const response = await apiClient.get('/api/feeds/export', { responseType: 'blob' });
    return response.data;
  }
}
```

### EntryService

**文件路径**: `frontend/packages/api-client/src/services/entries.ts`

```typescript
import { apiClient } from '../client';
import type { EntryListResponse, EntryResponse, UpdateEntryStateRequest } from '@glean/types';

export interface EntryFilters {
  feed_id?: string;
  folder_id?: string;
  is_read?: boolean;
  is_liked?: boolean;
  read_later?: boolean;
  page?: number;
  per_page?: number;
}

export class EntryService {
  /**
   * 获取条目列表
   */
  static async getEntries(filters: EntryFilters = {}): Promise<EntryListResponse> {
    const response = await apiClient.get('/api/entries', { params: filters });
    return response.data;
  }

  /**
   * 获取单个条目
   */
  static async getEntry(id: string): Promise<EntryResponse> {
    const response = await apiClient.get(`/api/entries/${id}`);
    return response.data;
  }

  /**
   * 更新条目状态
   */
  static async updateEntryState(id: string, data: UpdateEntryStateRequest): Promise<EntryResponse> {
    const response = await apiClient.patch(`/api/entries/${id}`, data);
    return response.data;
  }

  /**
   * 全部标为已读
   */
  static async markAllRead(feedId?: string, folderId?: string): Promise<void> {
    await apiClient.post('/api/entries/mark-all-read', { feed_id: feedId, folder_id: folderId });
  }
}
```

## TanStack Query Hooks

### useSubscriptions

**文件路径**: `frontend/apps/web/src/hooks/useSubscriptions.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FeedService } from '@glean/api-client';

// Query Key 工厂
export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  list: (folderId?: string) => [...subscriptionKeys.all, 'list', folderId] as const,
  detail: (id: string) => [...subscriptionKeys.all, 'detail', id] as const,
};

/**
 * 获取订阅列表
 */
export function useSubscriptions(folderId?: string) {
  return useQuery({
    queryKey: subscriptionKeys.list(folderId),
    queryFn: () => FeedService.getSubscriptions(folderId),
  });
}

/**
 * 获取单个订阅
 */
export function useSubscription(id: string) {
  return useQuery({
    queryKey: subscriptionKeys.detail(id),
    queryFn: () => FeedService.getSubscription(id),
    enabled: !!id,
  });
}

/**
 * 发现并订阅 Feed
 */
export function useDiscoverFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ url, folderId }: { url: string; folderId?: string }) =>
      FeedService.discoverFeed(url, folderId),
    onSuccess: () => {
      // 刷新订阅列表缓存
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}

/**
 * 更新订阅
 */
export function useUpdateSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; custom_title?: string; folder_id?: string | null }) =>
      FeedService.updateSubscription(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}

/**
 * 删除订阅
 */
export function useDeleteSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => FeedService.deleteSubscription(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}

/**
 * 刷新单个 Feed
 */
export function useRefreshFeed() {
  return useMutation({
    mutationFn: (subscriptionId: string) => FeedService.refreshFeed(subscriptionId),
  });
}

/**
 * 导入 OPML
 */
export function useImportOPML() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => FeedService.importOPML(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}
```

### useEntries

**文件路径**: `frontend/apps/web/src/hooks/useEntries.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EntryService, type EntryFilters } from '@glean/api-client';
import { subscriptionKeys } from './useSubscriptions';

// Query Key 工厂
export const entryKeys = {
  all: ['entries'] as const,
  list: (filters: EntryFilters) => [...entryKeys.all, 'list', filters] as const,
  detail: (id: string) => [...entryKeys.all, 'detail', id] as const,
};

/**
 * 获取条目列表
 */
export function useEntries(filters: EntryFilters = {}) {
  return useQuery({
    queryKey: entryKeys.list(filters),
    queryFn: () => EntryService.getEntries(filters),
  });
}

/**
 * 获取单个条目
 */
export function useEntry(id: string) {
  return useQuery({
    queryKey: entryKeys.detail(id),
    queryFn: () => EntryService.getEntry(id),
    enabled: !!id,
  });
}

/**
 * 更新条目状态
 */
export function useUpdateEntryState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; is_read?: boolean; is_liked?: boolean | null; read_later?: boolean }) =>
      EntryService.updateEntryState(id, data),
    onSuccess: () => {
      // 刷新条目列表和订阅列表 (更新未读计数)
      queryClient.invalidateQueries({ queryKey: entryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}

/**
 * 全部标为已读
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ feedId, folderId }: { feedId?: string; folderId?: string }) =>
      EntryService.markAllRead(feedId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    },
  });
}
```

## 页面组件

### ReaderPage (阅读器)

**文件路径**: `frontend/apps/web/src/pages/ReaderPage.tsx`

主要功能:
- 条目列表展示 (分页)
- 4 个过滤标签: 全部、未读、喜欢、稍后阅读
- 可调整大小的分栏布局
- 点击条目自动标记已读
- 全部标记已读按钮

```tsx
export default function ReaderPage() {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);

  // 根据过滤器构建查询参数
  const filters: EntryFilters = useMemo(() => {
    const base = { page, per_page: 20 };
    switch (activeFilter) {
      case 'unread': return { ...base, is_read: false };
      case 'liked': return { ...base, is_liked: true };
      case 'read_later': return { ...base, read_later: true };
      default: return base;
    }
  }, [activeFilter, page]);

  // 获取条目数据
  const { data: entriesData, isLoading } = useEntries(filters);
  const { mutate: updateState } = useUpdateEntryState();

  // 选择条目并标记已读
  const handleSelectEntry = (entry: EntryResponse) => {
    setSelectedEntryId(entry.id);
    if (!entry.is_read) {
      updateState({ id: entry.id, is_read: true });
    }
  };

  return (
    <div className="flex h-full">
      {/* 左侧条目列表 */}
      <div className="w-80 border-r overflow-y-auto">
        <FilterTabs active={activeFilter} onChange={setActiveFilter} />
        {isLoading ? (
          <EntryListSkeleton />
        ) : (
          <div>
            {entriesData?.entries.map(entry => (
              <EntryListItem
                key={entry.id}
                entry={entry}
                isSelected={entry.id === selectedEntryId}
                onClick={() => handleSelectEntry(entry)}
              />
            ))}
          </div>
        )}
        <Pagination
          page={page}
          totalPages={entriesData?.total_pages || 1}
          onChange={setPage}
        />
      </div>

      {/* 右侧文章内容 */}
      <div className="flex-1 overflow-y-auto">
        {selectedEntryId ? (
          <ArticleReader entryId={selectedEntryId} />
        ) : (
          <EmptyState message="选择一篇文章开始阅读" />
        )}
      </div>
    </div>
  );
}
```

### EntryListItem (条目列表项)

**文件路径**: `frontend/apps/web/src/pages/ReaderPage.tsx` (内部组件)

```tsx
function EntryListItem({
  entry,
  isSelected,
  onClick,
}: {
  entry: EntryResponse;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        'p-4 border-b cursor-pointer hover:bg-accent/50 transition-colors',
        isSelected && 'bg-accent',
        !entry.is_read && 'border-l-2 border-l-primary'  // 未读指示器
      )}
      onClick={onClick}
    >
      {/* Feed 信息 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {entry.feed_icon_url && (
          <img src={entry.feed_icon_url} className="w-4 h-4 rounded" alt="" />
        )}
        <span>{entry.feed_title}</span>
      </div>

      {/* 标题 */}
      <h3 className={cn('font-medium line-clamp-2', !entry.is_read && 'font-semibold')}>
        {entry.title}
      </h3>

      {/* 摘要 */}
      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
        {stripHtmlTags(entry.summary || entry.content)}
      </p>

      {/* 元信息和状态指示 */}
      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        {entry.author && <span>{entry.author}</span>}
        <span>{formatDate(entry.published_at)}</span>

        {/* 状态图标 */}
        <div className="ml-auto flex gap-1">
          {entry.is_liked === true && <ThumbsUp className="w-3 h-3 text-primary" />}
          {entry.is_liked === false && <ThumbsDown className="w-3 h-3 text-muted-foreground" />}
          {entry.read_later && <Clock className="w-3 h-3 text-primary" />}
        </div>
      </div>
    </div>
  );
}
```

### ArticleReader (文章阅读器)

**文件路径**: `frontend/apps/web/src/components/ArticleReader.tsx`

```tsx
interface ArticleReaderProps {
  entryId: string;
}

export function ArticleReader({ entryId }: ArticleReaderProps) {
  const { data: entry, isLoading } = useEntry(entryId);
  const { mutate: updateState } = useUpdateEntryState();
  const contentRef = useRef<HTMLDivElement>(null);

  // 内容增强 (语法高亮、图片画廊)
  useContentRenderer(contentRef, entry?.content);

  if (isLoading) return <ArticleReaderSkeleton />;
  if (!entry) return null;

  const handleToggleLike = () => {
    const newValue = entry.is_liked === true ? null : true;
    updateState({ id: entry.id, is_liked: newValue });
  };

  const handleToggleDislike = () => {
    const newValue = entry.is_liked === false ? null : false;
    updateState({ id: entry.id, is_liked: newValue });
  };

  const handleToggleReadLater = () => {
    updateState({ id: entry.id, read_later: !entry.read_later });
  };

  return (
    <article className="max-w-3xl mx-auto p-8">
      {/* 头部 */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-4">{entry.title}</h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          {entry.author && <span>{entry.author}</span>}
          <span>{formatDate(entry.published_at)}</span>
          <a href={entry.url} target="_blank" className="hover:text-primary">
            查看原文 <ExternalLink className="inline w-4 h-4" />
          </a>
        </div>
      </header>

      {/* 内容 */}
      <div
        ref={contentRef}
        className="prose prose-lg dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: entry.content || '' }}
      />

      {/* 操作按钮 */}
      <footer className="mt-8 pt-8 border-t flex items-center gap-4">
        <Button
          variant={entry.is_liked === true ? 'default' : 'outline'}
          onClick={handleToggleLike}
        >
          <ThumbsUp className="w-4 h-4 mr-2" />
          喜欢
        </Button>
        <Button
          variant={entry.is_liked === false ? 'default' : 'outline'}
          onClick={handleToggleDislike}
        >
          <ThumbsDown className="w-4 h-4 mr-2" />
          不喜欢
        </Button>
        <Button
          variant={entry.read_later ? 'default' : 'outline'}
          onClick={handleToggleReadLater}
        >
          <Clock className="w-4 h-4 mr-2" />
          {entry.read_later ? '取消稍后阅读' : '稍后阅读'}
        </Button>
        <Button variant="outline" onClick={() => updateState({ id: entry.id, is_read: !entry.is_read })}>
          {entry.is_read ? '标为未读' : '标为已读'}
        </Button>
      </footer>
    </article>
  );
}
```

### SubscriptionsPage (订阅管理)

**文件路径**: `frontend/apps/web/src/pages/SubscriptionsPage.tsx`

主要功能:
- 订阅列表表格
- 搜索过滤
- 多选批量删除
- OPML 导入/导出
- 单个/全部刷新

```tsx
export default function SubscriptionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: subscriptions, isLoading } = useSubscriptions();
  const { mutate: deleteSubscription } = useDeleteSubscription();
  const { mutate: batchDelete } = useBatchDeleteSubscriptions();
  const { mutate: refreshFeed } = useRefreshFeed();
  const { mutate: refreshAll } = useRefreshAllFeeds();
  const { mutate: importOPML } = useImportOPML();

  // 过滤订阅
  const filteredSubscriptions = useMemo(() => {
    if (!subscriptions) return [];
    if (!searchQuery) return subscriptions;
    const query = searchQuery.toLowerCase();
    return subscriptions.filter(
      sub => sub.feed.title?.toLowerCase().includes(query) ||
             sub.feed.url.toLowerCase().includes(query)
    );
  }, [subscriptions, searchQuery]);

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    batchDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleImport = async (file: File) => {
    importOPML(file);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">订阅管理</h1>
        <div className="flex gap-2">
          <Button onClick={() => refreshAll()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新全部
          </Button>
          <OPMLImportButton onImport={handleImport} />
          <OPMLExportButton />
        </div>
      </div>

      {/* 搜索和批量操作 */}
      <div className="flex items-center gap-4 mb-4">
        <Input
          placeholder="搜索订阅..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-64"
        />
        {selectedIds.size > 0 && (
          <Button variant="destructive" onClick={handleBatchDelete}>
            删除选中 ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* 订阅表格 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selectedIds.size === filteredSubscriptions.length}
                onCheckedChange={checked => {
                  if (checked) {
                    setSelectedIds(new Set(filteredSubscriptions.map(s => s.id)));
                  } else {
                    setSelectedIds(new Set());
                  }
                }}
              />
            </TableHead>
            <TableHead>订阅源</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredSubscriptions.map(subscription => (
            <SubscriptionRow
              key={subscription.id}
              subscription={subscription}
              selected={selectedIds.has(subscription.id)}
              onSelect={selected => {
                const newSet = new Set(selectedIds);
                if (selected) newSet.add(subscription.id);
                else newSet.delete(subscription.id);
                setSelectedIds(newSet);
              }}
              onRefresh={() => refreshFeed(subscription.id)}
              onDelete={() => deleteSubscription(subscription.id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

## 状态管理

### Folder Store

**文件路径**: `frontend/apps/web/src/stores/folderStore.ts`

```typescript
import { create } from 'zustand';
import { FolderService } from '@glean/api-client';
import type { FolderTreeNode } from '@glean/types';

interface FolderState {
  feedFolders: FolderTreeNode[];
  bookmarkFolders: FolderTreeNode[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchFolders: (type: 'feed' | 'bookmark') => Promise<void>;
  createFolder: (name: string, type: 'feed' | 'bookmark', parentId?: string) => Promise<FolderTreeNode>;
  updateFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null) => Promise<void>;
}

export const useFolderStore = create<FolderState>((set, get) => ({
  feedFolders: [],
  bookmarkFolders: [],
  loading: false,
  error: null,

  fetchFolders: async (type) => {
    set({ loading: true, error: null });
    try {
      const result = await FolderService.getFolders(type);
      if (type === 'feed') {
        set({ feedFolders: result.folders, loading: false });
      } else {
        set({ bookmarkFolders: result.folders, loading: false });
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createFolder: async (name, type, parentId) => {
    const folder = await FolderService.createFolder({ name, type, parent_id: parentId });
    await get().fetchFolders(type);
    return folder;
  },

  // ... 其他 actions
}));
```

## 内容渲染增强

### useContentRenderer

**文件路径**: `frontend/apps/web/src/hooks/useContentRenderer.ts`

```typescript
import { useEffect, useRef } from 'react';
import hljs from 'highlight.js';
import lightGallery from 'lightgallery';

export function useContentRenderer(
  contentRef: React.RefObject<HTMLDivElement>,
  content: string | undefined
) {
  useEffect(() => {
    if (!contentRef.current || !content) return;

    // 语法高亮
    contentRef.current.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block as HTMLElement);
    });

    // 图片画廊
    const images = contentRef.current.querySelectorAll('img');
    images.forEach(img => {
      if (!img.parentElement?.closest('a')) {
        const wrapper = document.createElement('a');
        wrapper.href = img.src;
        img.parentElement?.insertBefore(wrapper, img);
        wrapper.appendChild(img);
      }
    });

    const gallery = lightGallery(contentRef.current, {
      selector: 'a[href$=".jpg"], a[href$=".png"], a[href$=".gif"], a[href$=".webp"]',
    });

    return () => {
      gallery.destroy();
    };
  }, [content, contentRef]);
}
```

## 数据流总结

1. **组件挂载** → 调用 TanStack Query Hook
2. **Hook** → 调用 API Client Service
3. **Service** → 发送 HTTP 请求到 REST API
4. **API 响应** → TanStack Query 缓存数据
5. **组件渲染** → 使用缓存数据展示 UI
6. **用户交互** → 调用 Mutation Hook
7. **Mutation** → 更新服务器数据
8. **缓存失效** → 自动重新获取数据
9. **UI 更新** → 反映最新状态

## 相关文档

- [系统概述](./01-rss-overview.md)
- [API 接口](./05-rss-api.md)
- [数据库模型](./04-rss-database.md)
