# REST API 接口

本文档详细介绍 Glean 提供的 RSS Feed 相关 API 端点。

## 技术栈

- **FastAPI**: Web 框架
- **Pydantic**: 请求/响应数据验证
- **arq**: 异步任务队列集成

## 端点概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/feeds` | 获取订阅列表 |
| GET | `/api/feeds/{id}` | 获取单个订阅 |
| POST | `/api/feeds/discover` | 发现并订阅 Feed |
| PATCH | `/api/feeds/{id}` | 更新订阅设置 |
| DELETE | `/api/feeds/{id}` | 删除订阅 |
| POST | `/api/feeds/batch-delete` | 批量删除订阅 |
| POST | `/api/feeds/{id}/refresh` | 手动刷新单个 Feed |
| POST | `/api/feeds/refresh-all` | 刷新所有 Feed |
| POST | `/api/feeds/import` | 导入 OPML |
| GET | `/api/feeds/export` | 导出 OPML |
| GET | `/api/entries` | 获取条目列表 |
| GET | `/api/entries/{id}` | 获取单个条目 |
| PATCH | `/api/entries/{id}` | 更新条目状态 |
| POST | `/api/entries/mark-all-read` | 全部标为已读 |

## Feeds Router

**文件路径**: `backend/apps/api/glean_api/routers/feeds.py`

### 获取订阅列表

```
GET /api/feeds
```

**Query 参数**:
- `folder_id` (可选): 文件夹 ID，空字符串表示未分组的订阅

**响应**: `SubscriptionResponse[]`

```python
@router.get("")
async def list_subscriptions(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    folder_id: str | None = None,
) -> list[SubscriptionResponse]:
    """获取用户所有订阅"""
    return await feed_service.get_user_subscriptions(current_user.id, folder_id)
```

### 发现并订阅 Feed

```
POST /api/feeds/discover
```

**请求体**:
```json
{
  "url": "https://example.com",
  "folder_id": "optional-folder-id"
}
```

**响应**: `SubscriptionResponse` (201 Created)

**逻辑流程**:
1. 调用 `discover_feed()` 尝试发现 RSS URL
2. 创建 Feed 记录 (如不存在)
3. 创建 Subscription 关联用户和 Feed
4. 入队 `fetch_feed_task` 立即拉取内容

```python
@router.post("/discover", status_code=status.HTTP_201_CREATED)
async def discover_feed_url(
    data: DiscoverFeedRequest,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
) -> SubscriptionResponse:
    feed_url = str(data.url)
    feed_title = None

    import contextlib
    with contextlib.suppress(ValueError):
        # 尝试发现 Feed
        feed_url, feed_title = await discover_feed(feed_url)

    try:
        # 创建订阅
        subscription = await feed_service.create_subscription(
            current_user.id, feed_url, feed_title, data.folder_id
        )
        # 立即入队拉取任务
        await redis.enqueue_job("fetch_feed_task", subscription.feed.id)
        return subscription
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
```

### 更新订阅

```
PATCH /api/feeds/{subscription_id}
```

**请求体**:
```json
{
  "custom_title": "自定义标题",
  "folder_id": "folder-id",
  "feed_url": "https://new-feed-url.com"
}
```

**字段说明**:
- `custom_title`: 用户自定义标题
- `folder_id`: `"__unset__"` 表示不更新，`null` 表示移出文件夹
- `feed_url`: 更改 Feed URL (创建新 Feed)

```python
@router.patch("/{subscription_id}")
async def update_subscription(
    subscription_id: str,
    data: UpdateSubscriptionRequest,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
) -> SubscriptionResponse:
    should_update_folder = data.folder_id != "__unset__"
    return await feed_service.update_subscription(
        subscription_id,
        current_user.id,
        data.custom_title,
        data.folder_id if should_update_folder else UNSET,
        str(data.feed_url) if data.feed_url else None,
    )
```

### 手动刷新 Feed

```
POST /api/feeds/{subscription_id}/refresh
```

**响应**: `{ "status": "queued", "job_id": "xxx", "feed_id": "xxx" }` (202 Accepted)

```python
@router.post("/{subscription_id}/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_feed(
    subscription_id: str,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
) -> dict[str, str]:
    subscription = await feed_service.get_subscription(subscription_id, current_user.id)
    job = await redis.enqueue_job("fetch_feed_task", subscription.feed.id)
    return {"status": "queued", "job_id": job.job_id if job else "unknown", "feed_id": subscription.feed.id}
```

### 刷新所有 Feed

```
POST /api/feeds/refresh-all
```

**响应**: `{ "status": "queued", "queued_count": 10 }` (202 Accepted)

```python
@router.post("/refresh-all", status_code=status.HTTP_202_ACCEPTED)
async def refresh_all_feeds(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
) -> dict[str, int | str]:
    subscriptions = await feed_service.get_user_subscriptions(current_user.id)
    queued_count = 0
    for subscription in subscriptions:
        await redis.enqueue_job("fetch_feed_task", subscription.feed.id)
        queued_count += 1
    return {"status": "queued", "queued_count": queued_count}
```

### OPML 导入

```
POST /api/feeds/import
Content-Type: multipart/form-data
```

**请求**: 上传 OPML 文件

**响应**:
```json
{
  "success": 10,
  "failed": 2,
  "total": 12,
  "folders_created": 3
}
```

```python
@router.post("/import")
async def import_opml(
    file: UploadFile,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    folder_service: Annotated[FolderService, Depends(get_folder_service)],
    redis: Annotated[ArqRedis, Depends(get_redis_pool)],
) -> dict[str, int]:
    content = await file.read()
    opml_result = parse_opml_with_folders(content.decode("utf-8"))

    success_count = 0
    failed_count = 0
    folder_count = 0

    # 先创建文件夹
    folder_id_map: dict[str, str] = {}
    for folder_name in opml_result.folders:
        try:
            folder = await folder_service.create_folder(
                current_user.id,
                FolderCreate(name=folder_name, type="feed"),
            )
            folder_id_map[folder_name] = folder.id
            folder_count += 1
        except ValueError:
            # 文件夹已存在，查找已有的
            ...

    # 导入 Feed
    for opml_feed in opml_result.feeds:
        try:
            folder_id = folder_id_map.get(opml_feed.folder) if opml_feed.folder else None
            subscription = await feed_service.create_subscription(
                current_user.id, opml_feed.xml_url, opml_feed.title, folder_id
            )
            await redis.enqueue_job("fetch_feed_task", subscription.feed.id)
            success_count += 1
        except ValueError:
            failed_count += 1

    return {"success": success_count, "failed": failed_count, "total": len(opml_result.feeds), "folders_created": folder_count}
```

### OPML 导出

```
GET /api/feeds/export
```

**响应**: OPML 文件下载 (`application/xml`)

```python
@router.get("/export")
async def export_opml(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    feed_service: Annotated[FeedService, Depends(get_feed_service)],
    folder_service: Annotated[FolderService, Depends(get_folder_service)],
) -> Response:
    subscriptions = await feed_service.get_user_subscriptions(current_user.id)
    folder_tree = await folder_service.get_folders_tree(current_user.id, "feed")

    # 构建 folder_id -> name 映射
    folder_id_to_name = {...}

    feeds = [
        {
            "title": sub.custom_title or sub.feed.title,
            "url": sub.feed.url,
            "site_url": sub.feed.site_url,
            "folder": folder_id_to_name.get(sub.folder_id) if sub.folder_id else None,
        }
        for sub in subscriptions
    ]

    opml_content = generate_opml(feeds)
    return Response(
        content=opml_content,
        media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=glean-subscriptions.opml"},
    )
```

## Entries Router

**文件路径**: `backend/apps/api/glean_api/routers/entries.py`

### 获取条目列表

```
GET /api/entries
```

**Query 参数**:
- `feed_id` (可选): 按 Feed 过滤
- `folder_id` (可选): 按文件夹过滤 (包含文件夹内所有 Feed)
- `is_read` (可选): 按已读状态过滤
- `is_liked` (可选): 按喜欢状态过滤
- `read_later` (可选): 按稍后阅读过滤
- `page` (默认 1): 页码
- `per_page` (默认 20, 最大 100): 每页数量

**响应**: `EntryListResponse`

```python
@router.get("")
async def list_entries(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    entry_service: Annotated[EntryService, Depends(get_entry_service)],
    feed_id: str | None = None,
    folder_id: str | None = None,
    is_read: bool | None = None,
    is_liked: bool | None = None,
    read_later: bool | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> EntryListResponse:
    return await entry_service.get_entries(
        user_id=current_user.id,
        feed_id=feed_id,
        folder_id=folder_id,
        is_read=is_read,
        is_liked=is_liked,
        read_later=read_later,
        page=page,
        per_page=per_page,
    )
```

### 获取单个条目

```
GET /api/entries/{entry_id}
```

**响应**: `EntryResponse`

```python
@router.get("/{entry_id}")
async def get_entry(
    entry_id: str,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    entry_service: Annotated[EntryService, Depends(get_entry_service)],
) -> EntryResponse:
    try:
        return await entry_service.get_entry(entry_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
```

### 更新条目状态

```
PATCH /api/entries/{entry_id}
```

**请求体**:
```json
{
  "is_read": true,
  "is_liked": true,
  "read_later": false,
  "read_later_days": 7
}
```

**字段说明**:
- `is_read`: 标记已读/未读
- `is_liked`: `true`=喜欢, `false`=不喜欢, `null`=取消
- `read_later`: 标记稍后阅读
- `read_later_days`: 稍后阅读保留天数

**响应**: `EntryResponse`

```python
@router.patch("/{entry_id}")
async def update_entry_state(
    entry_id: str,
    data: UpdateEntryStateRequest,
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    entry_service: Annotated[EntryService, Depends(get_entry_service)],
) -> EntryResponse:
    try:
        return await entry_service.update_entry_state(entry_id, current_user.id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
```

### 全部标为已读

```
POST /api/entries/mark-all-read
```

**请求体**:
```json
{
  "feed_id": "optional-feed-id",
  "folder_id": "optional-folder-id"
}
```

**响应**: `{ "message": "All entries marked as read" }`

```python
class MarkAllReadRequest(BaseModel):
    feed_id: str | None = None
    folder_id: str | None = None


@router.post("/mark-all-read")
async def mark_all_read(
    current_user: Annotated[UserResponse, Depends(get_current_user)],
    entry_service: Annotated[EntryService, Depends(get_entry_service)],
    data: MarkAllReadRequest,
) -> dict[str, str]:
    await entry_service.mark_all_read(current_user.id, data.feed_id, data.folder_id)
    return {"message": "All entries marked as read"}
```

## Router 注册

**文件路径**: `backend/apps/api/glean_api/main.py`

```python
from .routers import admin, auth, bookmarks, entries, feeds, folders, tags

# Router 注册
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(feeds.router, prefix="/api/feeds", tags=["Feeds"])
app.include_router(entries.router, prefix="/api/entries", tags=["Entries"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(folders.router, prefix="/api/folders", tags=["Folders"])
app.include_router(tags.router, prefix="/api/tags", tags=["Tags"])
app.include_router(bookmarks.router, prefix="/api/bookmarks", tags=["Bookmarks"])
```

## 依赖注入

**文件路径**: `backend/apps/api/glean_api/dependencies.py`

```python
from glean_core.services import EntryService, FeedService, FolderService

async def get_current_user(...) -> UserResponse:
    """获取当前认证用户"""
    ...

async def get_feed_service(...) -> FeedService:
    """获取 FeedService 实例"""
    ...

async def get_entry_service(...) -> EntryService:
    """获取 EntryService 实例"""
    ...

async def get_redis_pool(...) -> ArqRedis:
    """获取 Redis 连接池"""
    ...
```

## 相关文档

- [系统概述](./01-rss-overview.md)
- [后台任务](./02-rss-worker-tasks.md)
- [数据库模型](./04-rss-database.md)
- [前端展示](./06-rss-frontend.md)
