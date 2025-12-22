# 前端设计文档

> 组件、路由、状态管理设计

## 路由结构

```
frontend/app/(reader)/
├── layout.tsx              # 根布局（Sidebar + 主内容区）
├── all/page.tsx            # 所有文章（现有）
├── unread/page.tsx         # 未读文章（现有）
├── starred/page.tsx        # 已星标（现有）
├── feed/[feedId]/          # RSS源相关（现有）
│
├── knowledge/              # 知识库【新增】
│   ├── page.tsx            # 知识实体列表 + 搜索
│   └── [entityId]/
│       └── page.tsx        # 实体详情 + 关系
│
├── graph/                  # 图可视化【新增】
│   └── page.tsx            # D3.js 力导向图
│
├── ingest/                 # 内容摄取【新增】
│   └── page.tsx            # 上传/导入界面
│
├── scratchpad/             # 草稿系统【新增】
│   ├── page.tsx            # 笔记列表
│   └── [noteId]/
│       └── page.tsx        # 编辑笔记
│
├── chat/                   # 知识问答【新增】
│   ├── page.tsx            # 对话列表
│   └── [conversationId]/
│       └── page.tsx        # 对话详情
│
└── settings/
    ├── general/page.tsx    # 通用设置（现有）
    ├── appearance/page.tsx # 外观设置（现有）
    └── knowledge/          # 知识管理设置【新增】
        └── page.tsx        # 嵌入模型、检索权重配置
```

---

## Zustand Store 扩展

### 新增 Slices

```typescript
// frontend/lib/store/index.ts

import { createKnowledgeSlice, KnowledgeSlice } from './knowledge.slice'
import { createContentSlice, ContentSlice } from './content.slice'
import { createScratchpadSlice, ScratchpadSlice } from './scratchpad.slice'
import { createConversationSlice, ConversationSlice } from './conversation.slice'

// 扩展现有 Store
export type RSSStore =
  & DatabaseSlice
  & FeedsSlice
  & ArticlesSlice
  & FoldersSlice
  & SettingsSlice
  & ApiConfigsSlice
  & UISlice
  // 新增
  & KnowledgeSlice
  & ContentSlice
  & ScratchpadSlice
  & ConversationSlice

export const useRSSStore = create<RSSStore>()(
  devtools(
    persist(
      (...a) => ({
        ...createDatabaseSlice(...a),
        ...createFeedsSlice(...a),
        ...createArticlesSlice(...a),
        ...createFoldersSlice(...a),
        ...createSettingsSlice(...a),
        ...createApiConfigsSlice(...a),
        ...createUISlice(...a),
        // 新增
        ...createKnowledgeSlice(...a),
        ...createContentSlice(...a),
        ...createScratchpadSlice(...a),
        ...createConversationSlice(...a),
      }),
      { name: 'rss-store' }
    )
  )
)
```

### knowledge.slice.ts

```typescript
export interface KnowledgeSlice {
  // State
  entities: KnowledgeEntity[]
  selectedEntity: KnowledgeEntity | null
  relations: Relation[]
  isLoadingEntities: boolean
  searchResults: SearchResult[]
  isSearching: boolean

  // Actions
  fetchEntities: (filters?: EntityFilters) => Promise<void>
  createEntity: (data: CreateEntityInput) => Promise<KnowledgeEntity>
  updateEntity: (id: string, data: UpdateEntityInput) => Promise<void>
  deleteEntity: (id: string) => Promise<void>
  selectEntity: (id: string | null) => void
  searchEntities: (query: string, options?: SearchOptions) => Promise<void>
  clearSearch: () => void

  // Relations
  createRelation: (data: CreateRelationInput) => Promise<void>
  deleteRelation: (id: string) => Promise<void>
}
```

### content.slice.ts

```typescript
export interface ContentSlice {
  // State
  contentSources: ContentSource[]
  isLoadingSources: boolean
  ingestionProgress: Record<string, number>

  // Actions
  fetchContentSources: (filters?: ContentFilters) => Promise<void>
  ingestUrl: (url: string) => Promise<ContentSource>
  ingestFile: (file: File) => Promise<ContentSource>
  ingestText: (content: string, title?: string) => Promise<ContentSource>
  deleteContentSource: (id: string) => Promise<void>
  updateProgress: (id: string, progress: number) => void
}
```

### scratchpad.slice.ts

```typescript
export interface ScratchpadSlice {
  // State
  notes: Scratchpad[]
  currentNote: Scratchpad | null
  isLoadingNotes: boolean

  // Actions
  fetchNotes: (isArchived?: boolean) => Promise<void>
  createNote: (content?: string) => Promise<Scratchpad>
  updateNote: (id: string, content: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  archiveNote: (id: string, triggerIngestion?: boolean) => Promise<void>
  selectNote: (id: string | null) => void
}
```

### conversation.slice.ts

```typescript
export interface ConversationSlice {
  // State
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Message[]
  isLoadingConversations: boolean
  isStreaming: boolean
  streamingContent: string
  references: Reference[]

  // Actions
  fetchConversations: () => Promise<void>
  createConversation: (title?: string) => Promise<Conversation>
  selectConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  appendStreamingContent: (chunk: string) => void
  setReferences: (refs: Reference[]) => void
  finishStreaming: (messageId: string) => void
}
```

---

## 组件结构

```
frontend/components/
├── ui/                     # shadcn/ui 基础组件（现有）
├── sidebar/                # 侧边栏（现有）
│   └── ...
├── article-list.tsx        # 文章列表（现有）
├── article-content.tsx     # 文章内容（现有）
│
├── knowledge/              # 知识库组件【新增】
│   ├── entity-card.tsx     # 实体卡片
│   ├── entity-list.tsx     # 实体列表
│   ├── entity-detail.tsx   # 实体详情
│   ├── entity-form.tsx     # 实体表单（创建/编辑）
│   ├── relation-badge.tsx  # 关系标签
│   ├── relation-list.tsx   # 关系列表
│   └── search-panel.tsx    # 混合搜索面板
│
├── graph/                  # 图可视化组件【新增】
│   ├── knowledge-graph.tsx # D3力导向图主组件
│   ├── graph-controls.tsx  # 缩放/过滤控件
│   ├── node-tooltip.tsx    # 节点悬停提示
│   └── entity-sidebar.tsx  # 选中实体侧边栏
│
├── ingest/                 # 内容摄取组件【新增】
│   ├── ingest-dialog.tsx   # 摄取对话框
│   ├── url-input.tsx       # URL输入
│   ├── file-upload.tsx     # 文件上传
│   ├── text-input.tsx      # 文本输入
│   └── progress-card.tsx   # 进度卡片
│
├── scratchpad/             # 草稿组件【新增】
│   ├── quick-note.tsx      # 快速笔记输入
│   ├── note-card.tsx       # 笔记卡片
│   ├── note-list.tsx       # 笔记列表
│   └── note-editor.tsx     # 笔记编辑器（Markdown）
│
└── chat/                   # 对话组件【新增】
    ├── conversation-list.tsx    # 对话列表
    ├── chat-input.tsx           # 消息输入
    ├── message-list.tsx         # 消息列表
    ├── message-with-refs.tsx    # 带引用的消息
    ├── reference-chip.tsx       # 引用标签
    └── streaming-response.tsx   # 流式响应显示
```

---

## 关键组件设计

### EntityCard

```tsx
// frontend/components/knowledge/entity-card.tsx

interface EntityCardProps {
  entity: KnowledgeEntity
  onClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function EntityCard({ entity, onClick, onEdit, onDelete }: EntityCardProps) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{entity.name}</CardTitle>
          <Badge variant="outline">{entity.entityType}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {entity.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {entity.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          {entity.hasEmbedding && (
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              已向量化
            </span>
          )}
          <span>{entity.relationsCount} 个关系</span>
        </div>
      </CardContent>
      {(onEdit || onDelete) && (
        <CardFooter className="pt-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {onEdit && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                  编辑
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                >
                  删除
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardFooter>
      )}
    </Card>
  )
}
```

### SearchPanel

```tsx
// frontend/components/knowledge/search-panel.tsx

interface SearchPanelProps {
  onSearch: (query: string, options?: SearchOptions) => void
  isSearching: boolean
  results: SearchResult[]
  onResultClick: (entityId: string) => void
}

export function SearchPanel({
  onSearch,
  isSearching,
  results,
  onResultClick
}: SearchPanelProps) {
  const [query, setQuery] = useState('')

  const handleSearch = useDebouncedCallback((q: string) => {
    if (q.trim()) {
      onSearch(q)
    }
  }, 300)

  return (
    <div className="search-panel">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜索知识库..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            handleSearch(e.target.value)
          }}
          className="pl-10"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium">搜索结果</h4>
          {results.map(result => (
            <SearchResultCard
              key={result.entity.id}
              result={result}
              onClick={() => onResultClick(result.entity.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

### IngestDialog

```tsx
// frontend/components/ingest/ingest-dialog.tsx

export function IngestDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<'url' | 'file' | 'text'>('url')
  const { ingestUrl, ingestFile, ingestText } = useRSSStore()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          添加内容
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>添加内容到知识库</DialogTitle>
        </DialogHeader>

        <Tabs value={type} onValueChange={(v) => setType(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="url">网页链接</TabsTrigger>
            <TabsTrigger value="file">上传文件</TabsTrigger>
            <TabsTrigger value="text">纯文本</TabsTrigger>
          </TabsList>

          <TabsContent value="url">
            <UrlInput
              onSubmit={async (url) => {
                await ingestUrl(url)
                setOpen(false)
              }}
            />
          </TabsContent>

          <TabsContent value="file">
            <FileUpload
              onSubmit={async (file) => {
                await ingestFile(file)
                setOpen(false)
              }}
            />
          </TabsContent>

          <TabsContent value="text">
            <TextInput
              onSubmit={async (content, title) => {
                await ingestText(content, title)
                setOpen(false)
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
```

### ChatInput

```tsx
// frontend/components/chat/chat-input.tsx

interface ChatInputProps {
  onSend: (content: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')

  const handleSend = () => {
    if (!content.trim() || disabled) return
    onSend(content)
    setContent('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-end gap-2 p-4 border-t">
      <Textarea
        placeholder="输入问题..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-[60px] max-h-[200px] resize-none"
        disabled={disabled}
      />
      <Button onClick={handleSend} disabled={disabled || !content.trim()}>
        <Send className="w-4 h-4" />
      </Button>
    </div>
  )
}
```

---

## 页面设计

### 知识库页面

```tsx
// frontend/app/(reader)/knowledge/page.tsx

export default function KnowledgePage() {
  const {
    entities,
    isLoadingEntities,
    fetchEntities,
    searchEntities,
    isSearching,
    searchResults,
    selectEntity
  } = useRSSStore()
  const router = useRouter()

  useEffect(() => {
    fetchEntities()
  }, [])

  const handleEntityClick = (id: string) => {
    router.push(`/knowledge/${id}`)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">知识库</h1>
          <IngestDialog />
        </div>
        <SearchPanel
          onSearch={searchEntities}
          isSearching={isSearching}
          results={searchResults}
          onResultClick={handleEntityClick}
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoadingEntities ? (
          <LoadingSpinner />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(searchResults.length > 0 ? searchResults.map(r => r.entity) : entities).map(entity => (
              <EntityCard
                key={entity.id}
                entity={entity}
                onClick={() => handleEntityClick(entity.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

### 对话页面

```tsx
// frontend/app/(reader)/chat/[conversationId]/page.tsx

export default function ChatPage({ params }: { params: { conversationId: string } }) {
  const {
    currentConversation,
    messages,
    isStreaming,
    streamingContent,
    references,
    selectConversation,
    sendMessage
  } = useRSSStore()

  useEffect(() => {
    selectConversation(params.conversationId)
  }, [params.conversationId])

  return (
    <div className="h-full flex flex-col">
      {/* 对话标题 */}
      <div className="p-4 border-b">
        <h1 className="font-semibold">
          {currentConversation?.title || '对话'}
        </h1>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-auto p-4">
        <MessageList messages={messages} />
        {isStreaming && (
          <StreamingResponse
            content={streamingContent}
            references={references}
          />
        )}
      </div>

      {/* 输入框 */}
      <ChatInput
        onSend={sendMessage}
        disabled={isStreaming}
      />
    </div>
  )
}
```

---

## Sidebar 扩展

在现有 Sidebar 中添加知识管理入口：

```tsx
// frontend/components/sidebar/sidebar.tsx (扩展)

// 在导航部分添加
<SidebarGroup>
  <SidebarGroupLabel>知识管理</SidebarGroupLabel>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href="/knowledge">
          <Brain className="w-4 h-4" />
          知识库
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href="/graph">
          <Network className="w-4 h-4" />
          知识图谱
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href="/ingest">
          <Upload className="w-4 h-4" />
          内容导入
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href="/scratchpad">
          <StickyNote className="w-4 h-4" />
          草稿
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link href="/chat">
          <MessageSquare className="w-4 h-4" />
          知识问答
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarGroup>
```

---

## API 客户端

```
frontend/lib/api/
├── feeds.ts        # 现有
├── articles.ts     # 现有
├── folders.ts      # 现有
├── settings.ts     # 现有
├── api-configs.ts  # 现有
│
├── knowledge.ts    # 知识实体 API【新增】
├── relations.ts    # 关系 API【新增】
├── content.ts      # 内容摄取 API【新增】
├── scratchpad.ts   # 草稿 API【新增】
├── conversation.ts # 对话 API【新增】
├── graph.ts        # 图数据 API【新增】
└── admin.ts        # 管理设置 API【新增】
```

---

## 类型定义

```typescript
// frontend/lib/types/knowledge.ts

export interface KnowledgeEntity {
  id: string
  userId: string
  name: string
  description?: string
  entityType: EntityType
  hasEmbedding: boolean
  sourceType?: SourceType
  sourceId?: string
  metadata: Record<string, any>
  relationsCount?: number
  createdAt: Date
  updatedAt: Date
}

export type EntityType =
  | 'concept'
  | 'person'
  | 'organization'
  | 'location'
  | 'event'
  | 'project'
  | 'idea'
  | 'tool'
  | 'book'

export type SourceType =
  | 'article'
  | 'content_source'
  | 'scratchpad'
  | 'manual'

export interface Relation {
  id: string
  sourceEntityId: string
  targetEntityId: string
  relationType: RelationType
  weight: number
  metadata: Record<string, any>
  createdAt: Date
}

export type RelationType =
  | 'related_to'
  | 'part_of'
  | 'instance_of'
  | 'causes'
  | 'precedes'
  | 'contradicts'
  | 'supports'

export interface SearchResult {
  entity: KnowledgeEntity
  scores: {
    vector: number
    fts: number
    graph: number
    final: number
  }
  sources: string[]
  relatedEntities?: {
    entity: KnowledgeEntity
    relationType: RelationType
  }[]
}

export interface ContentSource {
  id: string
  sourceType: 'url' | 'pdf' | 'audio' | 'image' | 'text'
  title: string
  url?: string
  filePath?: string
  content?: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingError?: string
  createdAt: Date
}

export interface Scratchpad {
  id: string
  content: string
  isArchived: boolean
  archivedAt?: Date
  isIngested: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Conversation {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  references: Reference[]
  createdAt: Date
}

export interface Reference {
  entityId: string
  entityName: string
  snippet: string
  score: number
}
```

---

## 完成

以上是 SaveHub 知识管理改造的完整规划文档。按照这些规格进行实现，可以逐步将 Minne 的知识管理能力移植到 SaveHub 中。
