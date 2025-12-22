# 内容摄取管道规格

> 5阶段处理管道：URL/PDF/音频/图像/文本 → 知识实体

## 支持的内容类型

| 类型 | 输入 | 处理方式 | 输出 |
|------|------|---------|------|
| **URL** | 网页链接 | HTTP抓取 + HTML解析 | 文本内容 |
| **PDF** | PDF文件 | PyMuPDF文本提取 | 文本内容 |
| **Audio** | 音频文件 | Whisper API转录 | 文本内容 |
| **Image** | 图片文件 | Vision API描述 | 文本内容 |
| **Text** | 纯文本 | 直接使用 | 文本内容 |

---

## 5阶段处理管道

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Prepare │───▶│ Retrieve│───▶│ Enrich  │───▶│  Embed  │───▶│ Persist │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
   下载/解析      查询上下文     LLM提取        生成向量       保存入库
```

### Stage 1: Prepare (准备)

**职责**: 下载/解析原始内容，统一为文本

```python
async def prepare_content(content_source: ContentSource) -> PrepareResult:
    """准备阶段：将各类内容转换为文本"""

    match content_source.source_type:
        case "url":
            return await extract_url_content(content_source.url)
        case "pdf":
            return await extract_pdf_content(content_source.file_path)
        case "audio":
            return await transcribe_audio(content_source.file_path)
        case "image":
            return await describe_image(content_source.file_path)
        case "text":
            return PrepareResult(text=content_source.content)
```

#### URL内容提取

```python
async def extract_url_content(url: str) -> PrepareResult:
    """提取URL网页内容"""
    # 1. HTTP请求
    response = await httpx.get(url, follow_redirects=True)

    # 2. HTML解析 (使用 readability-lxml 或 trafilatura)
    from trafilatura import extract
    text = extract(response.text)

    # 3. 提取元数据
    metadata = {
        "url": str(response.url),
        "title": extract_title(response.text),
        "author": extract_author(response.text),
        "publish_date": extract_date(response.text),
    }

    return PrepareResult(text=text, metadata=metadata)
```

#### PDF内容提取

```python
async def extract_pdf_content(file_path: str) -> PrepareResult:
    """提取PDF文本内容"""
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    text_parts = []

    for page in doc:
        text_parts.append(page.get_text())

    text = "\n\n".join(text_parts)

    # 如果文本提取失败，尝试OCR
    if len(text.strip()) < 100:
        text = await ocr_pdf(file_path)

    metadata = {
        "page_count": len(doc),
        "file_name": Path(file_path).name,
    }

    return PrepareResult(text=text, metadata=metadata)
```

#### 音频转录

```python
async def transcribe_audio(file_path: str) -> PrepareResult:
    """使用Whisper API转录音频"""
    from openai import AsyncOpenAI

    client = AsyncOpenAI()

    with open(file_path, "rb") as audio_file:
        transcript = await client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text"
        )

    metadata = {
        "file_name": Path(file_path).name,
        "duration": get_audio_duration(file_path),
    }

    return PrepareResult(text=transcript, metadata=metadata)
```

#### 图像描述

```python
async def describe_image(file_path: str) -> PrepareResult:
    """使用Vision API描述图像"""
    from openai import AsyncOpenAI

    client = AsyncOpenAI()

    with open(file_path, "rb") as image_file:
        base64_image = base64.b64encode(image_file.read()).decode()

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请详细描述这张图片的内容，包括主要元素、场景、文字（如果有）等信息。"
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                    }
                ]
            }
        ],
        max_tokens=1000
    )

    description = response.choices[0].message.content

    return PrepareResult(text=description, metadata={"file_name": Path(file_path).name})
```

### Stage 2: Retrieve (检索上下文)

**职责**: 查询已有知识图谱中的相关实体，为LLM提供上下文

```python
async def retrieve_related_context(text: str, user_id: str) -> RetrieveResult:
    """检索相关上下文"""
    # 1. 生成查询嵌入
    query_embedding = await embedding_service.embed(text[:2000])  # 截取前2000字符

    # 2. 向量搜索相关实体
    related_entities = await knowledge_service.search_entities(
        embedding=query_embedding,
        top_k=5,
        threshold=0.7
    )

    # 3. 构建上下文
    context = []
    for entity in related_entities:
        context.append({
            "id": entity.id,
            "name": entity.name,
            "description": entity.description,
            "type": entity.entity_type
        })

    return RetrieveResult(
        related_entities=related_entities,
        context=context
    )
```

### Stage 3: Enrich (LLM富化)

**职责**: 使用LLM从文本中提取实体和关系

```python
async def enrich_content(
    text: str,
    context: list[dict],
    user_id: str
) -> EnrichResult:
    """LLM富化：提取实体和关系"""

    # 构建提示词
    system_prompt = """你是一个知识提取专家。从给定的文本中提取知识实体和它们之间的关系。

输出JSON格式:
{
  "entities": [
    {
      "key": "e1",  // 临时标识符
      "name": "实体名称",
      "description": "简短描述",
      "entity_type": "concept|person|organization|location|event|project|idea|tool|book"
    }
  ],
  "relationships": [
    {
      "source": "e1",  // 可以是临时key或已有实体ID
      "target": "e2",
      "relation_type": "related_to|part_of|instance_of|causes|precedes|contradicts|supports",
      "context": "关系的上下文说明"
    }
  ]
}

注意:
1. 只提取重要的、有意义的实体
2. 实体名称应该简洁、规范
3. 如果发现与已有实体相关，在relationships中使用已有实体的ID"""

    user_prompt = f"""已有知识实体:
{json.dumps(context, ensure_ascii=False, indent=2)}

请从以下文本中提取知识实体和关系:

{text[:8000]}"""  # 截取前8000字符

    response = await llm_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        max_tokens=2000
    )

    result = json.loads(response.choices[0].message.content)

    return EnrichResult(
        entities=result.get("entities", []),
        relationships=result.get("relationships", [])
    )
```

### Stage 4: Embed (生成向量)

**职责**: 为新实体生成嵌入向量

```python
async def embed_entities(entities: list[dict]) -> list[dict]:
    """批量生成实体嵌入"""
    texts = []
    for entity in entities:
        text = f"{entity['name']}\n{entity.get('description', '')}"
        texts.append(text)

    embeddings = await embedding_service.batch_embed(texts)

    for entity, embedding in zip(entities, embeddings):
        entity["embedding"] = embedding

    return entities
```

### Stage 5: Persist (持久化)

**职责**: 事务性保存实体和关系

```python
async def persist_results(
    content_source_id: str,
    entities: list[dict],
    relationships: list[dict],
    user_id: str
) -> PersistResult:
    """事务性保存结果"""

    # 1. 建立临时key到UUID的映射
    key_to_id = {}

    # 2. 插入实体
    created_entities = []
    for entity in entities:
        new_entity = await knowledge_service.create_entity({
            "name": entity["name"],
            "description": entity.get("description"),
            "entity_type": entity["entity_type"],
            "embedding": entity["embedding"],
            "source_type": "content_source",
            "source_id": content_source_id,
            "metadata": entity.get("metadata", {})
        })
        key_to_id[entity["key"]] = new_entity.id
        created_entities.append(new_entity)

    # 3. 插入关系
    created_relations = []
    for rel in relationships:
        # 解析source和target（可能是临时key或已有UUID）
        source_id = key_to_id.get(rel["source"], rel["source"])
        target_id = key_to_id.get(rel["target"], rel["target"])

        new_relation = await relation_service.create_relation({
            "source_entity_id": source_id,
            "target_entity_id": target_id,
            "relation_type": rel["relation_type"],
            "metadata": {"context": rel.get("context")}
        })
        created_relations.append(new_relation)

    # 4. 更新内容源状态
    await content_service.update_status(
        content_source_id,
        status="completed",
        result={
            "entities_count": len(created_entities),
            "relations_count": len(created_relations)
        }
    )

    return PersistResult(
        entities=created_entities,
        relations=created_relations
    )
```

---

## Celery 任务设计

### 主任务：内容摄取

```python
# backend/app/celery_app/knowledge_tasks.py

@celery_app.task(
    name="ingest_content",
    bind=True,
    max_retries=3,
    default_retry_delay=60
)
def ingest_content(
    self,
    content_source_id: str,
    user_id: str
) -> dict:
    """内容摄取主任务"""
    try:
        # 1. 获取内容源
        content_source = content_service.get(content_source_id)
        update_task_status(content_source_id, "processing", progress=10)

        # 2. Stage 1: Prepare
        prepare_result = asyncio.run(prepare_content(content_source))
        update_task_status(content_source_id, "processing", progress=30)

        # 3. Stage 2: Retrieve
        retrieve_result = asyncio.run(
            retrieve_related_context(prepare_result.text, user_id)
        )
        update_task_status(content_source_id, "processing", progress=40)

        # 4. Stage 3: Enrich
        enrich_result = asyncio.run(
            enrich_content(prepare_result.text, retrieve_result.context, user_id)
        )
        update_task_status(content_source_id, "processing", progress=60)

        # 5. Stage 4: Embed
        entities_with_embeddings = asyncio.run(
            embed_entities(enrich_result.entities)
        )
        update_task_status(content_source_id, "processing", progress=80)

        # 6. Stage 5: Persist
        persist_result = asyncio.run(persist_results(
            content_source_id,
            entities_with_embeddings,
            enrich_result.relationships,
            user_id
        ))
        update_task_status(content_source_id, "succeeded", progress=100)

        return {
            "status": "success",
            "entities_count": len(persist_result.entities),
            "relations_count": len(persist_result.relations)
        }

    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        update_task_status(content_source_id, "failed", error=str(e))

        # 重试
        raise self.retry(exc=e)
```

### 文件上传处理

```python
@celery_app.task(name="process_uploaded_file")
def process_uploaded_file(
    file_path: str,
    file_name: str,
    mime_type: str,
    user_id: str
) -> str:
    """处理上传的文件"""
    # 1. 确定文件类型
    source_type = detect_source_type(mime_type, file_name)

    # 2. 创建内容源记录
    content_source = content_service.create({
        "source_type": source_type,
        "title": file_name,
        "file_path": file_path,
        "file_name": file_name,
        "mime_type": mime_type,
        "processing_status": "pending"
    }, user_id)

    # 3. 触发摄取任务
    ingest_content.delay(content_source.id, user_id)

    return content_source.id


def detect_source_type(mime_type: str, file_name: str) -> str:
    """根据MIME类型检测内容源类型"""
    if mime_type == "application/pdf":
        return "pdf"
    elif mime_type.startswith("audio/"):
        return "audio"
    elif mime_type.startswith("image/"):
        return "image"
    elif mime_type.startswith("text/"):
        return "text"
    else:
        # 根据扩展名判断
        ext = Path(file_name).suffix.lower()
        return {
            ".pdf": "pdf",
            ".mp3": "audio",
            ".wav": "audio",
            ".m4a": "audio",
            ".png": "image",
            ".jpg": "image",
            ".jpeg": "image",
            ".txt": "text",
            ".md": "text",
        }.get(ext, "text")
```

---

## API 端点

### 创建内容摄取

```http
POST /api/content/ingest
Content-Type: multipart/form-data

# URL类型
type=url
url=https://example.com/article

# 或文件类型
type=file
file=@document.pdf

# 或纯文本
type=text
content=这是一段需要处理的文本...
title=我的笔记
```

**响应**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "sourceType": "url",
  "title": "Article Title",
  "processingStatus": "pending",
  "taskId": "celery-task-id",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### 获取摄取状态

```http
GET /api/content/sources/{id}
```

**响应**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "sourceType": "url",
  "title": "Article Title",
  "url": "https://example.com/article",
  "processingStatus": "completed",
  "processedAt": "2024-01-15T10:35:00Z",
  "result": {
    "entitiesCount": 5,
    "relationsCount": 3
  },
  "entities": [
    {"id": "...", "name": "Entity 1", "entityType": "concept"}
  ]
}
```

### 列表内容源

```http
GET /api/content/sources?
  page=1&
  pageSize=20&
  sourceType=pdf&
  status=completed
```

---

## 错误处理

### 重试策略

```python
RETRY_CONFIG = {
    "max_retries": 3,
    "retry_delays": [60, 120, 300],  # 1分钟, 2分钟, 5分钟
    "retryable_errors": [
        "ConnectionError",
        "TimeoutError",
        "RateLimitError",
    ]
}
```

### 错误分类

| 错误类型 | 处理方式 |
|---------|---------|
| 网络错误 | 重试 |
| 速率限制 | 指数退避重试 |
| 文件损坏 | 标记失败，不重试 |
| LLM错误 | 重试（可能换模型） |
| 存储错误 | 重试 |

---

## 配额和限制

| 资源 | 限制 |
|------|------|
| 单文件大小 | 50MB |
| URL响应大小 | 10MB |
| 音频时长 | 30分钟 |
| 图片分辨率 | 4096x4096 |
| 文本长度 | 100,000字符 |
| 每分钟请求 | 10次/用户 |

---

## 下一步

继续阅读 `04-hybrid-retrieval.md` 了解混合检索的详细规格。
