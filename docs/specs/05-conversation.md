# 对话系统规格

> LLM驱动的知识问答，SSE流式响应，引用追溯

## 核心概念

### 对话 (Conversation)

```typescript
interface Conversation {
  id: string
  userId: string
  title: string
  contextEntityIds: string[]  // 关联的知识实体
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}
```

### 消息 (Message)

```typescript
interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  references: Reference[]  // 引用追溯（仅 assistant）
  metadata: MessageMetadata
  createdAt: Date
}

interface Reference {
  entityId: string
  entityName: string
  snippet: string      // 引用片段
  score: number        // 相关度
}

interface MessageMetadata {
  model?: string       // 使用的模型
  tokensUsed?: number  // 消耗的token
  retrievalTimeMs?: number
  generationTimeMs?: number
}
```

---

## 对话流程

```
用户消息
    │
    ▼
┌─────────────────┐
│ 1. 混合检索     │ ← 获取相关知识实体
│   HybridSearch  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 构建上下文   │ ← 组装系统提示词 + 知识上下文
│  BuildContext   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. LLM 生成     │ ← SSE 流式响应
│   StreamChat    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. 保存消息     │ ← 保存用户消息 + 助手回复
│  SaveMessages   │
└─────────────────┘
```

---

## RAG 上下文构建

### 系统提示词模板

```python
SYSTEM_PROMPT_TEMPLATE = """你是一个知识助手，基于用户的个人知识库回答问题。

## 知识库上下文
以下是与用户问题相关的知识内容：

{knowledge_context}

## 回答指南
1. 优先使用知识库中的信息回答问题
2. 如果知识库中没有相关信息，诚实告知用户
3. 引用知识时，使用 [[实体名称]] 格式标注来源
4. 保持回答简洁、准确、有条理
5. 如果需要，可以结合你的通用知识进行补充说明

## 当前对话上下文
{conversation_history}
"""
```

### 上下文构建

```python
async def build_chat_context(
    query: str,
    conversation_id: str,
    user_id: str,
    max_context_tokens: int = 3000
) -> ChatContext:
    """构建对话上下文"""

    # 1. 混合检索相关知识
    search_results = await hybrid_retrieval.search(
        query=query,
        user_id=user_id,
        options=SearchOptions(top_k=5)
    )

    # 2. 构建知识上下文
    knowledge_parts = []
    references = []
    current_tokens = 0

    for result in search_results.results:
        entity_text = f"### {result.entity.name}\n"
        if result.entity.description:
            entity_text += f"{result.entity.description}\n"

        # 估算 token 数
        estimated_tokens = len(entity_text) // 4
        if current_tokens + estimated_tokens > max_context_tokens:
            break

        knowledge_parts.append(entity_text)
        current_tokens += estimated_tokens

        references.append(Reference(
            entityId=result.entity.id,
            entityName=result.entity.name,
            snippet=result.entity.description[:200] if result.entity.description else "",
            score=result.final_score
        ))

    knowledge_context = "\n".join(knowledge_parts)

    # 3. 获取对话历史
    messages = await get_recent_messages(conversation_id, limit=10)
    conversation_history = format_conversation_history(messages)

    # 4. 组装系统提示词
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        knowledge_context=knowledge_context or "（暂无相关知识）",
        conversation_history=conversation_history or "（新对话）"
    )

    return ChatContext(
        system_prompt=system_prompt,
        references=references,
        retrieval_results=search_results.results
    )
```

---

## SSE 流式响应

### 后端实现

```python
# backend/app/api/routers/conversation.py

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/conversation", tags=["conversation"])


@router.post("/{conversation_id}/message")
async def send_message(
    conversation_id: str,
    request: SendMessageRequest,
    user_id: str = Depends(get_current_user_id),
    llm_service: LLMService = Depends(get_llm_service)
):
    """发送消息并获取流式响应"""

    async def generate():
        try:
            # 1. 保存用户消息
            user_message = await message_service.create(
                conversation_id=conversation_id,
                role="user",
                content=request.content
            )
            yield {"event": "user_message", "data": json.dumps({"id": user_message.id})}

            # 2. 构建上下文
            context = await build_chat_context(
                query=request.content,
                conversation_id=conversation_id,
                user_id=user_id
            )
            yield {"event": "context_ready", "data": json.dumps({
                "references": [r.dict() for r in context.references]
            })}

            # 3. 流式生成回复
            full_response = ""
            async for chunk in llm_service.stream_chat(
                system_prompt=context.system_prompt,
                user_message=request.content
            ):
                full_response += chunk
                yield {"event": "chunk", "data": chunk}

            # 4. 保存助手消息
            assistant_message = await message_service.create(
                conversation_id=conversation_id,
                role="assistant",
                content=full_response,
                references=context.references,
                metadata={
                    "model": llm_service.model,
                    "retrieval_time_ms": context.retrieval_time_ms
                }
            )
            yield {"event": "done", "data": json.dumps({
                "id": assistant_message.id,
                "references": [r.dict() for r in context.references]
            })}

        except Exception as e:
            logger.error(f"Chat error: {e}")
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(generate())
```

### LLM 流式服务

```python
# backend/app/services/llm/client.py

class LLMService:
    def __init__(self, api_config: ApiConfig):
        self.client = AsyncOpenAI(
            api_key=api_config.api_key,
            base_url=api_config.api_base
        )
        self.model = api_config.model

    async def stream_chat(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """流式生成回复"""

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=temperature,
            stream=True
        )

        async for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
```

---

## 前端实现

### EventSource 客户端

```typescript
// frontend/lib/api/conversation.ts

export async function sendMessage(
  conversationId: string,
  content: string,
  onChunk: (chunk: string) => void,
  onReferences: (refs: Reference[]) => void,
  onDone: (messageId: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const response = await fetch(`/api/backend/conversation/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    credentials: 'include'
  })

  if (!response.ok) {
    throw new Error('Failed to send message')
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  if (!reader) {
    throw new Error('No response body')
  }

  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 解析 SSE 事件
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()

        switch (eventType) {
          case 'chunk':
            onChunk(data)
            break
          case 'context_ready':
            const { references } = JSON.parse(data)
            onReferences(references)
            break
          case 'done':
            const { id } = JSON.parse(data)
            onDone(id)
            break
          case 'error':
            const { message } = JSON.parse(data)
            onError(message)
            break
        }
      }
    }
  }
}
```

### Zustand Slice

```typescript
// frontend/lib/store/conversation.slice.ts

export interface ConversationSlice {
  // State
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Message[]
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

export const createConversationSlice: StateCreator<ConversationSlice> = (set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  references: [],

  sendMessage: async (content: string) => {
    const { currentConversation } = get()
    if (!currentConversation) return

    // 添加用户消息到本地状态
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      conversationId: currentConversation.id,
      role: 'user',
      content,
      references: [],
      createdAt: new Date()
    }
    set(state => ({
      messages: [...state.messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      references: []
    }))

    // 发送并处理流式响应
    await sendMessage(
      currentConversation.id,
      content,
      // onChunk
      (chunk) => {
        set(state => ({
          streamingContent: state.streamingContent + chunk
        }))
      },
      // onReferences
      (refs) => {
        set({ references: refs })
      },
      // onDone
      (messageId) => {
        const { streamingContent, references } = get()
        const assistantMessage: Message = {
          id: messageId,
          conversationId: currentConversation.id,
          role: 'assistant',
          content: streamingContent,
          references,
          createdAt: new Date()
        }
        set(state => ({
          messages: [...state.messages, assistantMessage],
          isStreaming: false,
          streamingContent: ''
        }))
      },
      // onError
      (error) => {
        console.error('Chat error:', error)
        set({ isStreaming: false })
      }
    )
  }
})
```

---

## UI 组件

### 消息带引用

```tsx
// frontend/components/chat/message-with-refs.tsx

interface MessageWithRefsProps {
  message: Message
  onReferenceClick: (entityId: string) => void
}

export function MessageWithRefs({ message, onReferenceClick }: MessageWithRefsProps) {
  const contentWithLinks = useMemo(() => {
    // 将 [[实体名称]] 转换为可点击链接
    return message.content.replace(
      /\[\[(.*?)\]\]/g,
      (match, name) => {
        const ref = message.references.find(r => r.entityName === name)
        if (ref) {
          return `<span class="reference-link" data-entity-id="${ref.entityId}">${name}</span>`
        }
        return name
      }
    )
  }, [message.content, message.references])

  return (
    <div className={cn("message", message.role)}>
      <div
        className="message-content"
        dangerouslySetInnerHTML={{ __html: contentWithLinks }}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.classList.contains('reference-link')) {
            const entityId = target.dataset.entityId
            if (entityId) onReferenceClick(entityId)
          }
        }}
      />

      {message.references.length > 0 && (
        <div className="message-references">
          <span className="label">引用来源：</span>
          {message.references.map(ref => (
            <ReferenceChip
              key={ref.entityId}
              reference={ref}
              onClick={() => onReferenceClick(ref.entityId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

### 流式响应显示

```tsx
// frontend/components/chat/streaming-response.tsx

interface StreamingResponseProps {
  content: string
  references: Reference[]
}

export function StreamingResponse({ content, references }: StreamingResponseProps) {
  return (
    <div className="message assistant streaming">
      <div className="message-content">
        {content}
        <span className="cursor-blink">|</span>
      </div>

      {references.length > 0 && (
        <div className="retrieval-info">
          <span>正在参考 {references.length} 个知识条目...</span>
        </div>
      )}
    </div>
  )
}
```

---

## API 端点

### 创建对话

```http
POST /api/conversation
Content-Type: application/json

{
  "title": "关于Rust的问题"
}
```

### 获取对话列表

```http
GET /api/conversation?
  page=1&
  pageSize=20&
  sortBy=updatedAt&
  sortOrder=desc
```

### 发送消息（SSE）

```http
POST /api/conversation/{id}/message
Content-Type: application/json

{
  "content": "Rust的所有权系统是如何工作的？"
}
```

### 获取历史消息

```http
GET /api/conversation/{id}/messages?
  limit=50&
  before={messageId}
```

---

## 下一步

继续阅读 `06-scratchpad.md` 了解草稿系统的详细规格。
