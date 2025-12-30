# Article Image Download & Storage

将 RSS 文章中的图片下载并存储到 Supabase Storage，解决外链图片失效、加载慢等问题。

## 已完成

### SQL Migration (`backend/scripts/018_create_article_images_storage.sql`)

**1. Storage Bucket**
```
名称: article-images
访问: 私有 (authenticated)
大小限制: 10MB
MIME类型: jpeg, png, gif, webp, svg, avif, bmp, jpg
```

**2. RLS Policies**
- 路径结构: `{user_id}/{article_id}/{image_hash}.{ext}`
- 用户只能访问自己 user_id 目录下的图片
- Service role (Celery) 绑过 RLS，可直接上传

**3. Articles 表新增列**
| 列名 | 类型 | 说明 |
|------|------|------|
| `images_processed` | BOOLEAN | NULL=未处理, true=完成, false=全部失败 |
| `images_processed_at` | TIMESTAMPTZ | 处理完成时间 |

**4. 索引**
- `idx_articles_images_unprocessed`: 部分索引，加速查询未处理文章

---

## 待实现

### 1. Celery Task: 图片处理任务

**文件**: `backend/app/celery_app/tasks/image_processor.py`

**流程**:
```
1. 查询 images_processed IS NULL 的文章
2. 解析 content HTML，提取所有 <img src="...">
3. 对每个图片:
   a. 下载图片 (复用 proxy.py 的下载逻辑)
   b. 压缩图片 (Pillow)
   c. 生成 hash: hashlib.md5(image_bytes).hexdigest()
   d. 上传到 Storage: {user_id}/{article_id}/{hash}.{ext}
   e. 获取 Storage URL
4. 替换 content 中的图片 URL
5. 更新文章: images_processed=true, images_processed_at=now()
```

**失败处理**:
- 单个图片下载失败 → 保留原始 URL
- 所有图片都失败 → images_processed=false

**触发时机**:
- 新文章入库后自动触发
- 或定时任务扫描未处理文章

### 2. 图片压缩服务

**文件**: `backend/app/services/image_compressor.py`

**功能**:
```python
def compress_image(image_bytes: bytes, max_size: int = 1920) -> bytes:
    """
    - 调整尺寸: 最大边不超过 max_size
    - 转换格式: 统一输出 webp (体积小)
    - 质量压缩: quality=85
    """
```

**依赖**: `Pillow`

### 3. 前端: Signed URL 处理

由于存储桶是私有的，前端需要处理签名 URL。

**方案 A: 后端代理**
```
GET /api/storage/image/{path}
→ 后端验证权限 → 返回图片
```

**方案 B: 前端获取签名 URL**
```typescript
const { data } = await supabase.storage
  .from('article-images')
  .createSignedUrl(path, 3600) // 1小时有效
```

**方案 C: 内容预处理**
- 后端返回文章时，将 Storage URL 替换为签名 URL
- 需要缓存签名 URL 避免频繁生成

### 4. 清理任务: 孤儿图片

文章删除后，Storage 中的图片不会自动删除。

**方案**:
```python
# 定时任务: 每周清理
1. 列出 Storage 中所有图片路径
2. 从路径提取 article_id
3. 检查 article_id 是否存在
4. 删除孤儿图片
```

---

## 设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 存储桶访问 | 私有 | 防止盗链，保护用户数据 |
| 路径结构 | user/article/hash | 便于 RLS，便于按文章清理 |
| URL 替换 | 直接修改 content | 简单，无需映射表 |
| 失败处理 | 保留原链接 | 降级显示优于完全失败 |
| 去重 | 不做 | 暂时不需要，后续可加 |

---

## 相关文件

- SQL Migration: `backend/scripts/018_create_article_images_storage.sql`
- 图片代理 (参考): `backend/app/api/routers/proxy.py`
- Celery 配置: `backend/app/celery_app/`
- Supabase Client: `backend/app/supabase_client.py`
