# Phase 3: Embedding 服务实现

## 概述

实现 Embedding 生成服务，支持调用 OpenAI 兼容的 embedding API。

## 新建文件

### 1. `lib/embedding/service.ts`

```typescript
import { logger } from "@/lib/logger"
import type { EmbeddingConfig } from "@/lib/types"

/**
 * 准备文本用于生成 embedding
 * - 移除 HTML 标签
 * - 截断到安全长度（避免超出 token 限制）
 */
export function prepareTextForEmbedding(title: string, content: string): string {
  // 移除 HTML 标签
  const stripHtml = (html: string) => {
    return html
      .replace(/<[^>]*>/g, ' ')  // 移除标签
      .replace(/&nbsp;/g, ' ')   // 替换 HTML 实体
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')      // 合并空白
      .trim()
  }

  const cleanTitle = stripHtml(title)
  const cleanContent = stripHtml(content)

  // 组合标题和内容
  const combined = `${cleanTitle}\n\n${cleanContent}`

  // 截断到 6000 字符（约 8000 tokens 的安全范围）
  const maxLength = 6000
  if (combined.length > maxLength) {
    return combined.slice(0, maxLength) + '...'
  }

  return combined
}

/**
 * 生成单个文本的 embedding
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<number[]> {
  const { apiKey, apiBase, model } = config

  logger.debug({ model, textLength: text.length }, 'Generating embedding')

  const response = await fetch(`${apiBase}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error({ status: response.status, error: errorText }, 'Embedding API error')
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()

  // OpenAI 格式: { data: [{ embedding: number[] }] }
  const embedding = data.data?.[0]?.embedding

  if (!embedding || !Array.isArray(embedding)) {
    logger.error({ data }, 'Invalid embedding response format')
    throw new Error('Invalid embedding response format')
  }

  logger.debug({ dimensions: embedding.length }, 'Embedding generated successfully')
  return embedding
}

/**
 * 批量生成 embedding（带并发限制）
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  config: EmbeddingConfig,
  concurrency: number = 3
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null)

  // 分批处理
  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency)
    const batchPromises = batch.map(async (text, idx) => {
      try {
        const embedding = await generateEmbedding(text, config)
        results[i + idx] = embedding
      } catch (error) {
        logger.error({ error, index: i + idx }, 'Failed to generate embedding for batch item')
        results[i + idx] = null
      }
    })

    await Promise.all(batchPromises)

    // 添加小延迟避免 rate limiting
    if (i + concurrency < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return results
}

/**
 * 为文章生成 embedding
 */
export async function generateArticleEmbedding(
  article: { title: string; content: string },
  config: EmbeddingConfig
): Promise<number[]> {
  const text = prepareTextForEmbedding(article.title, article.content)
  return generateEmbedding(text, config)
}
```

### 2. `lib/embedding/validation.ts`

```typescript
import { logger } from "@/lib/logger"

export interface EmbeddingValidationResult {
  success: boolean
  models?: string[]
  error?: string
}

/**
 * 验证 Embedding API 凭证并获取可用模型
 */
export async function validateEmbeddingApi(
  apiKey: string,
  apiBase: string
): Promise<EmbeddingValidationResult> {
  try {
    logger.debug({ apiBase }, 'Validating embedding API')

    const response = await fetch(`${apiBase}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error({ status: response.status, error: errorText }, 'Embedding API validation failed')
      return {
        success: false,
        error: `API 验证失败: ${response.status}`,
      }
    }

    const data = await response.json()

    // 过滤出 embedding 模型
    const models = (data.data || [])
      .filter((m: any) => {
        const id = m.id?.toLowerCase() || ''
        // 匹配常见的 embedding 模型名称
        return id.includes('embed') ||
               id.includes('embedding') ||
               id.includes('text-embedding')
      })
      .map((m: any) => m.id)

    logger.info({ modelCount: models.length }, 'Embedding API validated successfully')

    return {
      success: true,
      models,
    }
  } catch (error) {
    logger.error({ error }, 'Embedding API validation error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 获取模型的默认维度
 */
export function getDefaultDimensions(model: string): number {
  const modelLower = model.toLowerCase()

  // OpenAI 模型
  if (modelLower.includes('text-embedding-3-small')) return 1536
  if (modelLower.includes('text-embedding-3-large')) return 3072
  if (modelLower.includes('text-embedding-ada-002')) return 1536

  // 其他常见模型
  if (modelLower.includes('bge-small')) return 384
  if (modelLower.includes('bge-base')) return 768
  if (modelLower.includes('bge-large')) return 1024

  // 默认值
  return 1536
}

/**
 * 验证 API Base URL 格式
 */
export function validateApiBaseUrl(apiBase: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(apiBase)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: '必须使用 HTTP 或 HTTPS 协议' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: '无效的 URL 格式' }
  }
}
```

### 3. `lib/embedding/index.ts`（入口文件）

```typescript
export {
  prepareTextForEmbedding,
  generateEmbedding,
  generateEmbeddingsBatch,
  generateArticleEmbedding,
} from './service'

export {
  validateEmbeddingApi,
  getDefaultDimensions,
  validateApiBaseUrl,
  type EmbeddingValidationResult,
} from './validation'
```

## 使用示例

### 生成单篇文章的 embedding

```typescript
import { generateArticleEmbedding } from '@/lib/embedding'

const config = {
  apiKey: 'sk-xxx',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
}

const article = {
  title: '如何学习编程',
  content: '<p>编程是一门需要实践的技能...</p>',
}

try {
  const embedding = await generateArticleEmbedding(article, config)
  console.log('Embedding dimensions:', embedding.length)
} catch (error) {
  console.error('Failed to generate embedding:', error)
}
```

### 验证 API 配置

```typescript
import { validateEmbeddingApi, getDefaultDimensions } from '@/lib/embedding'

const result = await validateEmbeddingApi('sk-xxx', 'https://api.openai.com/v1')

if (result.success) {
  console.log('可用的 embedding 模型:', result.models)

  // 获取模型的默认维度
  const model = result.models[0]
  const dimensions = getDefaultDimensions(model)
  console.log(`${model} 默认维度:`, dimensions)
} else {
  console.error('API 验证失败:', result.error)
}
```

## 错误处理

服务层会抛出以下类型的错误：

| 错误类型 | 原因 | 处理建议 |
|---------|------|---------|
| `Embedding API error: 401` | API Key 无效 | 检查 API Key 配置 |
| `Embedding API error: 429` | 超出速率限制 | 等待后重试 |
| `Embedding API error: 500` | 服务端错误 | 稍后重试 |
| `Invalid embedding response format` | API 返回格式不兼容 | 检查 API 是否兼容 OpenAI 格式 |

## 下一步

完成 Embedding 服务后，继续 [Phase 4: 数据库层更新](./04-database-layer.md)
