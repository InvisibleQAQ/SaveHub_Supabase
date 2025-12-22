# 草稿系统规格

> 快速笔记输入 → 归档触发知识摄取

## 核心概念

草稿系统是知识输入的快速通道，用户可以随时记录想法、笔记、链接等内容，然后选择归档将其转化为知识图谱中的实体。

```typescript
interface Scratchpad {
  id: string
  userId: string
  content: string        // 笔记内容（支持Markdown）
  isArchived: boolean    // 是否已归档
  archivedAt?: Date      // 归档时间
  isIngested: boolean    // 是否已摄取到知识图谱
  ingestedAt?: Date      // 摄取时间
  createdAt: Date
  updatedAt: Date
}
```

---

## 用户流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         草稿系统流程                            │
└─────────────────────────────────────────────────────────────────┘

  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────────┐
  │ 快速    │────▶│  编辑   │────▶│  归档   │────▶│ 摄取到      │
  │ 创建    │     │  笔记   │     │ Archive │     │ 知识图谱    │
  └─────────┘     └─────────┘     └─────────┘     └─────────────┘
       │               │               │                 │
       │               │               │                 │
       ▼               ▼               ▼                 ▼
  [空白笔记]     [Markdown编辑]  [触发Celery]    [生成实体+关系]
                 [实时保存]       [状态更新]
```

---

## 功能列表

| 操作 | API | 描述 |
|------|-----|------|
| 创建 | `POST /api/scratchpad` | 创建新笔记 |
| 列表 | `GET /api/scratchpad` | 获取笔记列表 |
| 更新 | `PUT /api/scratchpad/{id}` | 更新笔记内容 |
| 删除 | `DELETE /api/scratchpad/{id}` | 删除笔记 |
| 归档 | `POST /api/scratchpad/{id}/archive` | 归档并触发摄取 |

---

## 详细规格

### 创建笔记

**请求**:
```http
POST /api/scratchpad
Content-Type: application/json

{
  "content": "# 今天学到的\n\nRust的所有权系统..."
}
```

**响应**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "content": "# 今天学到的\n\nRust的所有权系统...",
  "isArchived": false,
  "isIngested": false,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### 列表查询

**请求**:
```http
GET /api/scratchpad?
  isArchived=false&
  page=1&
  pageSize=20&
  sortBy=updatedAt&
  sortOrder=desc
```

**响应**:
```json
{
  "data": [
    {
      "id": "...",
      "content": "# 今天学到的...",
      "isArchived": false,
      "isIngested": false,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:35:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 15
  }
}
```

### 更新笔记

**请求**:
```http
PUT /api/scratchpad/{id}
Content-Type: application/json

{
  "content": "# 更新后的内容\n\n..."
}
```

### 归档笔记

归档操作会触发内容摄取，将笔记内容转化为知识图谱中的实体。

**请求**:
```http
POST /api/scratchpad/{id}/archive
Content-Type: application/json

{
  "triggerIngestion": true  // 是否触发摄取（默认true）
}
```

**响应**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "isArchived": true,
  "archivedAt": "2024-01-15T11:00:00Z",
  "ingestionTaskId": "celery-task-id",  // 如果触发了摄取
  "message": "笔记已归档，正在处理中..."
}
```

---

## 后端实现

### Service

```python
# backend/app/services/db/scratchpad.py

class ScratchpadService:
    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    async def create(self, content: str) -> Scratchpad:
        """创建笔记"""
        result = await self.supabase.from_("scratchpad").insert({
            "user_id": self.user_id,
            "content": content,
            "is_archived": False,
            "is_ingested": False
        }).execute()
        return Scratchpad(**result.data[0])

    async def list(
        self,
        is_archived: Optional[bool] = None,
        page: int = 1,
        page_size: int = 20
    ) -> PaginatedResult:
        """列表查询"""
        query = self.supabase.from_("scratchpad") \
            .select("*", count="exact") \
            .eq("user_id", self.user_id) \
            .order("updated_at", desc=True)

        if is_archived is not None:
            query = query.eq("is_archived", is_archived)

        offset = (page - 1) * page_size
        query = query.range(offset, offset + page_size - 1)

        result = await query.execute()
        return PaginatedResult(
            data=[Scratchpad(**item) for item in result.data],
            total=result.count,
            page=page,
            page_size=page_size
        )

    async def update(self, note_id: str, content: str) -> Scratchpad:
        """更新笔记"""
        result = await self.supabase.from_("scratchpad") \
            .update({
                "content": content,
                "updated_at": datetime.utcnow().isoformat()
            }) \
            .eq("id", note_id) \
            .eq("user_id", self.user_id) \
            .execute()
        return Scratchpad(**result.data[0])

    async def delete(self, note_id: str) -> bool:
        """删除笔记"""
        await self.supabase.from_("scratchpad") \
            .delete() \
            .eq("id", note_id) \
            .eq("user_id", self.user_id) \
            .execute()
        return True

    async def archive(
        self,
        note_id: str,
        trigger_ingestion: bool = True
    ) -> ArchiveResult:
        """归档笔记"""
        # 1. 更新归档状态
        result = await self.supabase.from_("scratchpad") \
            .update({
                "is_archived": True,
                "archived_at": datetime.utcnow().isoformat()
            }) \
            .eq("id", note_id) \
            .eq("user_id", self.user_id) \
            .execute()

        note = Scratchpad(**result.data[0])
        task_id = None

        # 2. 触发摄取任务
        if trigger_ingestion:
            task_id = ingest_scratchpad.delay(note_id, self.user_id)

        return ArchiveResult(
            note=note,
            ingestion_task_id=str(task_id) if task_id else None
        )
```

### Celery 任务

```python
# backend/app/celery_app/knowledge_tasks.py

@celery_app.task(name="ingest_scratchpad")
def ingest_scratchpad(note_id: str, user_id: str) -> dict:
    """摄取草稿到知识图谱"""

    # 1. 获取笔记内容
    note = scratchpad_service.get(note_id)

    # 2. 创建内容源记录
    content_source = content_service.create({
        "source_type": "text",
        "title": f"Scratchpad: {note_id[:8]}",
        "content": note.content,
        "processing_status": "pending"
    }, user_id)

    # 3. 调用通用摄取管道
    result = ingest_content(content_source.id, user_id)

    # 4. 更新笔记状态
    scratchpad_service.mark_ingested(note_id)

    return {
        "status": "success",
        "content_source_id": content_source.id,
        "entities_count": result.get("entities_count", 0)
    }
```

### Router

```python
# backend/app/api/routers/scratchpad.py

from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/scratchpad", tags=["scratchpad"])


@router.post("")
async def create_note(
    request: CreateNoteRequest,
    user_id: str = Depends(get_current_user_id),
    scratchpad_service: ScratchpadService = Depends(get_scratchpad_service)
):
    """创建笔记"""
    note = await scratchpad_service.create(request.content)
    return note


@router.get("")
async def list_notes(
    is_archived: Optional[bool] = None,
    page: int = 1,
    page_size: int = 20,
    user_id: str = Depends(get_current_user_id),
    scratchpad_service: ScratchpadService = Depends(get_scratchpad_service)
):
    """列表查询"""
    return await scratchpad_service.list(is_archived, page, page_size)


@router.put("/{note_id}")
async def update_note(
    note_id: str,
    request: UpdateNoteRequest,
    user_id: str = Depends(get_current_user_id),
    scratchpad_service: ScratchpadService = Depends(get_scratchpad_service)
):
    """更新笔记"""
    return await scratchpad_service.update(note_id, request.content)


@router.delete("/{note_id}")
async def delete_note(
    note_id: str,
    user_id: str = Depends(get_current_user_id),
    scratchpad_service: ScratchpadService = Depends(get_scratchpad_service)
):
    """删除笔记"""
    await scratchpad_service.delete(note_id)
    return {"status": "deleted"}


@router.post("/{note_id}/archive")
async def archive_note(
    note_id: str,
    request: ArchiveRequest = ArchiveRequest(),
    user_id: str = Depends(get_current_user_id),
    scratchpad_service: ScratchpadService = Depends(get_scratchpad_service)
):
    """归档笔记"""
    result = await scratchpad_service.archive(note_id, request.trigger_ingestion)
    return result
```

---

## 前端实现

### Zustand Slice

```typescript
// frontend/lib/store/scratchpad.slice.ts

export interface ScratchpadSlice {
  notes: Scratchpad[]
  isLoading: boolean
  currentNote: Scratchpad | null

  fetchNotes: (isArchived?: boolean) => Promise<void>
  createNote: (content?: string) => Promise<Scratchpad>
  updateNote: (id: string, content: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  archiveNote: (id: string, triggerIngestion?: boolean) => Promise<void>
  selectNote: (id: string | null) => void
}

export const createScratchpadSlice: StateCreator<ScratchpadSlice> = (set, get) => ({
  notes: [],
  isLoading: false,
  currentNote: null,

  fetchNotes: async (isArchived) => {
    set({ isLoading: true })
    try {
      const response = await scratchpadApi.list({ isArchived })
      set({ notes: response.data })
    } finally {
      set({ isLoading: false })
    }
  },

  createNote: async (content = '') => {
    const note = await scratchpadApi.create({ content })
    set(state => ({ notes: [note, ...state.notes] }))
    return note
  },

  updateNote: async (id, content) => {
    const note = await scratchpadApi.update(id, { content })
    set(state => ({
      notes: state.notes.map(n => n.id === id ? note : n),
      currentNote: state.currentNote?.id === id ? note : state.currentNote
    }))
  },

  deleteNote: async (id) => {
    await scratchpadApi.delete(id)
    set(state => ({
      notes: state.notes.filter(n => n.id !== id),
      currentNote: state.currentNote?.id === id ? null : state.currentNote
    }))
  },

  archiveNote: async (id, triggerIngestion = true) => {
    const result = await scratchpadApi.archive(id, { triggerIngestion })
    set(state => ({
      notes: state.notes.map(n => n.id === id ? { ...n, isArchived: true } : n)
    }))

    if (result.ingestionTaskId) {
      // 可选：显示处理进度通知
      toast.info('笔记正在处理中...')
    }
  },

  selectNote: (id) => {
    const note = id ? get().notes.find(n => n.id === id) : null
    set({ currentNote: note })
  }
})
```

### 快速笔记组件

```tsx
// frontend/components/scratchpad/quick-note.tsx

export function QuickNote() {
  const [content, setContent] = useState('')
  const { createNote } = useRSSStore()
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!content.trim()) return

    setIsSaving(true)
    try {
      await createNote(content)
      setContent('')
      toast.success('笔记已保存')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="quick-note">
      <Textarea
        placeholder="快速记录想法..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[100px]"
      />
      <div className="flex justify-end mt-2">
        <Button
          onClick={handleSave}
          disabled={!content.trim() || isSaving}
        >
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </div>
    </div>
  )
}
```

### 笔记列表组件

```tsx
// frontend/components/scratchpad/note-list.tsx

export function NoteList() {
  const { notes, isLoading, fetchNotes, selectNote, archiveNote, deleteNote } = useRSSStore()
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    fetchNotes(showArchived)
  }, [showArchived])

  if (isLoading) {
    return <LoadingSpinner />
  }

  return (
    <div className="note-list">
      <div className="flex items-center justify-between mb-4">
        <h2>我的笔记</h2>
        <Switch
          checked={showArchived}
          onCheckedChange={setShowArchived}
          label="显示已归档"
        />
      </div>

      {notes.length === 0 ? (
        <EmptyState message="暂无笔记" />
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => selectNote(note.id)}
              onArchive={() => archiveNote(note.id)}
              onDelete={() => deleteNote(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

---

## 页面路由

```
/scratchpad                 # 草稿列表页
/scratchpad/new             # 新建笔记
/scratchpad/{id}            # 编辑笔记
```

---

## 下一步

继续阅读 `07-visualization.md` 了解图可视化的详细规格。
