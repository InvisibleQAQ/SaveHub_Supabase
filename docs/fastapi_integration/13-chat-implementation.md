# Chat 功能实现（无状态设计）

## 概述

本文档详细说明如何在 FastAPI 后端实现无状态 Chat 功能，包括 API 端点、Langchain 集成和流式响应。

**设计决策**: Chat 采用**无状态设计**，不存储聊天记录到数据库。聊天历史由前端管理，每次请求携带完整对话历史。

**参考项目**: `reference_repository/nextjs-starter-template` 的 Chat 实现模式（简化版）
**实施阶段**: 阶段二（在 RSS 迁移验证后实施）

> **📖 前置依赖**: 请先完成 [11-fastapi-backend-setup.md](./11-fastapi-backend-setup.md) 中的基础设施搭建。

---

## 架构设计

### 无状态 vs 有状态

| 特性 | 无状态（本方案） | 有状态 |
|------|------------------|--------|
| 聊天历史存储 | 前端 Context | 数据库 |
| 数据库表 | 无需额外表 | chat_sessions, messages |
| 请求体 | 包含完整对话历史 | 仅当前消息 |
| 会话恢复 | 刷新页面后丢失 | 可持久化 |
| 复杂度 | 低 | 高 |
| 适用场景 | 临时对话、轻量使用 | 需要历史记录的场景 |

### 数据流

```
前端 (messages Context)
    │
    │ POST /api/chat/completions
    │ body: { messages: [...], model?: string }
    │
    v
FastAPI /api/chat/completions
    │
    │ 1. 验证 JWT
    │ 2. 获取用户 API 配置
    │ 3. 解密 API 凭证
    │ 4. 调用 LLM (Langchain)
    │
    v
StreamingResponse
    │
    │ 0:"{chunk}"\n (Vercel AI SDK 格式)
    │
    v
前端 useChat hook
```

---

## Chat Schemas

```python
# backend/app/schemas/chat.py

from typing import List, Optional, Literal
from pydantic import BaseModel


class ChatMessage(BaseModel):
    """单条聊天消息"""
    role: Literal["user", "assistant", "system"]
    content: str


class ChatCompletionRequest(BaseModel):
    """
    Chat 完成请求。

    前端携带完整对话历史，后端无状态处理。
    """
    messages: List[ChatMessage]
    model: Optional[str] = None  # 可选：覆盖默认模型
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None


class ChatCompletionResponse(BaseModel):
    """非流式响应（备用）"""
    content: str
    model: str
    usage: Optional[dict] = None
```

---

## Chat Service

无状态版本的 Chat Service，不涉及数据库操作：

```python
# backend/app/services/chat_service.py

"""
Chat Service - 无状态 LLM 流式处理

设计: 无状态，不存储聊天记录
流式格式: 0:"{chunk}"\n (Vercel AI SDK Data Stream Protocol)
"""

from typing import List, AsyncGenerator, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from sqlalchemy.orm import Session

from app.schemas.chat import ChatMessage
from app.services.encryption_service import decrypt, is_encrypted


# ============================================
# 系统提示词
# ============================================

SYSTEM_TEMPLATE = """You are a helpful assistant that helps users explore and understand their RSS feed content.

You can:
- Answer questions about articles the user has read
- Summarize content from their feeds
- Help discover connections between different articles
- Provide insights and analysis

Be concise, helpful, and accurate. If you don't know something, say so.
When discussing specific articles, reference them clearly."""


# ============================================
# 辅助函数
# ============================================

def get_user_api_config(db: Session, user_id: str) -> dict | None:
    """
    获取用户的默认 API 配置。

    优先级:
    1. is_default=True 且 is_active=True 的配置
    2. 任意 is_active=True 的配置
    """
    # 使用原始 SQL 查询 api_configs 表
    from sqlalchemy import text

    # 尝试获取默认配置
    result = db.execute(text("""
        SELECT id, name, api_key, api_base, model, is_default, is_active
        FROM api_configs
        WHERE user_id = :user_id AND is_default = true AND is_active = true
        LIMIT 1
    """), {"user_id": user_id}).fetchone()

    if result:
        return {
            "id": str(result[0]),
            "name": result[1],
            "api_key": result[2],
            "api_base": result[3],
            "model": result[4],
            "is_default": result[5],
            "is_active": result[6]
        }

    # 回退到任意活跃配置
    result = db.execute(text("""
        SELECT id, name, api_key, api_base, model, is_default, is_active
        FROM api_configs
        WHERE user_id = :user_id AND is_active = true
        LIMIT 1
    """), {"user_id": user_id}).fetchone()

    if result:
        return {
            "id": str(result[0]),
            "name": result[1],
            "api_key": result[2],
            "api_base": result[3],
            "model": result[4],
            "is_default": result[5],
            "is_active": result[6]
        }

    return None


# ============================================
# 核心流式处理
# ============================================

async def stream_chat_completion(
    db: Session,
    user_id: str,
    messages: List[ChatMessage],
    model_override: str | None = None,
    temperature: float = 0.7
) -> StreamingResponse:
    """
    处理聊天请求并返回流式响应（无状态）。

    流式格式: Vercel AI SDK Data Stream Protocol
    - 文本块: 0:"{chunk}"\n

    Args:
        db: 数据库会话（仅用于获取 API 配置）
        user_id: 用户 ID
        messages: 完整对话历史（由前端提供）
        model_override: 可选模型覆盖
        temperature: 生成温度

    Returns:
        StreamingResponse: 流式响应
    """
    # 1. 获取用户 API 配置
    api_config = get_user_api_config(db, user_id)
    if not api_config:
        raise HTTPException(
            status_code=400,
            detail="No API configuration found. Please configure an API in settings."
        )

    # 2. 解密 API 凭证
    api_key = api_config["api_key"]
    api_base = api_config["api_base"]

    if is_encrypted(api_key):
        api_key = decrypt(api_key)
    if is_encrypted(api_base):
        api_base = decrypt(api_base)

    # 3. 创建 LLM 客户端
    model_name = model_override or api_config["model"]

    llm = ChatOpenAI(
        model=model_name,
        streaming=True,
        openai_api_key=api_key,
        openai_api_base=api_base,
        temperature=temperature,
    )

    # 4. 构建 Langchain 消息
    langchain_messages = [("system", SYSTEM_TEMPLATE)]
    for msg in messages:
        langchain_messages.append((msg.role, msg.content))

    prompt = ChatPromptTemplate.from_messages(langchain_messages)
    chain = prompt | llm | StrOutputParser()

    # 5. 流式生成器（无状态，不保存到数据库）
    async def generate() -> AsyncGenerator[str, None]:
        try:
            async for chunk in chain.astream({}):
                # Vercel AI SDK 数据流格式
                # 转义引号和换行符
                escaped = chunk.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
                yield f'0:"{escaped}"\n'
        except Exception as e:
            # 发送错误信息
            error_msg = str(e).replace('"', '\\"')
            yield f'0:"Error: {error_msg}"\n'

    response = StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )

    # 添加 Vercel AI SDK 需要的头
    response.headers["x-vercel-ai-data-stream"] = "v1"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Connection"] = "keep-alive"

    return response
```

---

## Chat API 路由

简化版 Chat API，仅提供流式完成端点：

```python
# backend/app/api/routers/chat.py

"""
Chat Router - 无状态流式聊天

设计: 无状态，不存储聊天记录
端点:
- POST /completions - 流式聊天完成（主端点）
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_user_id
from app.schemas.chat import ChatCompletionRequest
from app.services.chat_service import stream_chat_completion

router = APIRouter()


@router.post("/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """
    流式聊天完成（无状态）。

    前端携带完整对话历史，后端仅处理当前请求，不存储任何数据。

    Request Body:
        - messages: 完整对话历史 [{"role": "user/assistant", "content": "..."}]
        - model: (可选) 覆盖默认模型
        - temperature: (可选) 生成温度，默认 0.7

    Response:
        StreamingResponse: Vercel AI SDK 格式的流式响应
        格式: 0:"{chunk}"\n
    """
    return await stream_chat_completion(
        db=db,
        user_id=user_id,
        messages=request.messages,
        model_override=request.model,
        temperature=request.temperature or 0.7
    )
```

---

## 更新 main.py

在 FastAPI 主应用中注册 Chat 路由：

```python
# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.api.routers import rss, chat

# 创建所有表（不包括 Chat 相关表，因为无状态设计）
Base.metadata.create_all(bind=engine)

app = FastAPI(title="RSS Reader API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(rss.router, prefix="/api/rss", tags=["RSS"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])


@app.get("/health")
def health_check():
    return {"status": "healthy"}
```

---

## 前端集成

### AuthContext 和 Token 管理

参考 `nextjs-starter-template/frontend/src/context/AuthContext.tsx`：

```typescript
// lib/context/auth-context.tsx

"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"

interface AuthContextType {
  user: User | null
  loading: boolean
  getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  getToken: async () => null
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 获取初始会话
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // 监听认证状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const getToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  return (
    <AuthContext.Provider value={{ user, loading, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

### Chat 页面组件（简化版）

```typescript
// app/(reader)/chat/page.tsx

"use client"

import { useEffect, useState, useRef } from "react"
import { useChat } from "ai/react"
import { useAuth } from "@/lib/context/auth-context"

import { ChatMessages } from "@/components/chat/chat-messages"
import { ChatInput } from "@/components/chat/chat-input"

/**
 * Chat 页面（无状态设计）
 *
 * 特点:
 * - 不存储聊天记录到数据库
 * - 聊天历史由 useChat hook 内部管理
 * - 刷新页面后历史消息丢失
 */
export default function ChatPage() {
  const { getToken, user, loading: authLoading } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 获取 JWT token
  useEffect(() => {
    if (!authLoading && user) {
      getToken().then(setToken)
    }
  }, [authLoading, user, getToken])

  // useChat hook (Vercel AI SDK)
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error
  } = useChat({
    // 通过 rewrites 转发到 FastAPI
    api: "/api/backend/chat/completions",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // 匹配后端的 0:"{chunk}"\n 格式
    streamProtocol: "data",
  })

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 认证检查
  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Please sign in to use chat.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 错误提示 */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2">
          Error: {error.message}
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <ChatMessages messages={messages} isLoading={isLoading} />
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t p-4">
        <ChatInput
          input={input}
          isLoading={isLoading}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
```

### Chat 组件目录结构（简化版）

```
components/chat/
├── chat-messages.tsx    # 消息显示组件
├── chat-input.tsx       # 输入框组件
├── chat-message.tsx     # 单条消息组件
└── index.ts             # 导出
```

> **📝 Note**: 无状态设计不需要会话侧边栏组件。

---

## Next.js Rewrites 配置

确保 `next.config.js` 配置了 rewrites：

```javascript
// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ]
  },
}

module.exports = nextConfig
```

---

## 测试 Chat 功能

### 1. 启动服务

```bash
# 终端 1: FastAPI 后端
cd backend
poetry run uvicorn app.main:app --reload --port 8000

# 终端 2: Next.js 前端
pnpm dev
```

### 2. API 测试

```bash
# 获取 JWT token（从浏览器 DevTools 复制）
TOKEN="your_supabase_jwt_token"

# 测试流式聊天
curl -X POST http://localhost:8000/api/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### 3. 流式响应验证

发送消息后应该看到类似这样的流式输出：

```
0:"Hello"
0:"!"
0:" I'm"
0:" doing"
0:" well"
0:"."
```

---

## 故障排除

### 流式响应不工作

**检查**:
1. 确保 `x-vercel-ai-data-stream: v1` header 存在
2. 确保使用 `text/event-stream` content-type
3. 确保 Next.js Rewrites 配置正确（`next.config.js`）
4. 检查 FastAPI 是否正在运行（`http://localhost:8000/health`）

> **💡 提示**：使用 Next.js Rewrites 后，无需担心 CORS 问题。

### API 配置错误

**检查**:
1. 用户是否有配置 API Config（在 Settings → API 页面）
2. API Config 是否 `is_active=true`
3. 加密的凭证是否能正确解密

### 认证失败

**检查**:
1. JWT token 是否有效（未过期）
2. `get_user_id` 依赖是否正确验证 token
3. Supabase 项目 URL 和 anon key 是否正确配置

---

## 下一步

完成 Chat 功能后，继续：

1. **[14-frontend-integration.md](./14-frontend-integration.md)** - 前端集成指南
2. **RAG 集成** - 检索 RSS 文章内容增强回答
3. **语义搜索** - 基于 pgvector 的文章搜索

---

## 可选：升级到有状态设计

如果未来需要存储聊天记录，可以参考原 `nextjs-starter-template` 的实现：

1. 添加 `chat_sessions` 和 `messages` 数据库表
2. 创建 `ChatSession` 和 `Message` ORM 模型
3. 扩展 Chat Service 添加消息保存逻辑
4. 扩展 API 添加会话 CRUD 端点
5. 前端添加会话列表侧边栏

具体实现可参考 `reference_repository/nextjs-starter-template/backend/` 目录。
