import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'

export interface ApiValidationRequest {
  apiKey: string
  apiBase: string
  model: string
}

export interface ApiValidationResult {
  success: boolean
  error?: string
  details?: {
    latency?: number
    modelSupported?: boolean
  }
  models?: string[]
}

/**
 * Get available models from the API
 * Returns a list of available model IDs
 */
export async function getAvailableModels(config: Pick<ApiValidationRequest, 'apiKey' | 'apiBase'>): Promise<string[]> {
  try {
    const baseUrl = config.apiBase.endsWith('/') ? config.apiBase : `${config.apiBase}/`
    const modelsUrl = `${baseUrl}models`

    const response = await fetch(modelsUrl, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    // OpenAI-compatible API should return models in this format
    if (data.data && Array.isArray(data.data)) {
      return data.data
        .map((model: any) => model.id)
        .filter((id: string) => id && typeof id === 'string')
        .sort()
    }

    return []
  } catch (error) {
    console.error('[API Validation] Failed to fetch models:', error)
    return []
  }
}

/**
 * Validate API credentials and optionally fetch available models
 */
export async function validateApiCredentials(config: Pick<ApiValidationRequest, 'apiKey' | 'apiBase'>): Promise<ApiValidationResult> {
  try {
    const startTime = Date.now()

    // First, try to get the models list
    const models = await getAvailableModels(config)

    if (models.length === 0) {
      return {
        success: false,
        error: 'API Key或API Base URL无效，无法获取模型列表'
      }
    }

    const latency = Date.now() - startTime

    return {
      success: true,
      models,
      details: {
        latency,
        modelSupported: true,
      }
    }
  } catch (error) {
    console.error('[API Validation] Failed to validate API credentials:', error)

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()

      if (errorMessage.includes('unauthorized') || errorMessage.includes('invalid api key') || errorMessage.includes('401')) {
        return {
          success: false,
          error: 'API Key无效或已过期'
        }
      }

      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        return {
          success: false,
          error: 'API Base URL错误，请检查地址是否正确'
        }
      }

      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        return {
          success: false,
          error: 'API请求频率限制，请稍后重试'
        }
      }

      if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
        return {
          success: false,
          error: '网络连接超时，请检查API Base URL'
        }
      }

      if (errorMessage.includes('quota') || errorMessage.includes('billing')) {
        return {
          success: false,
          error: 'API配额不足或账单问题'
        }
      }

      return {
        success: false,
        error: `验证失败: ${error.message}`
      }
    }

    return {
      success: false,
      error: '验证过程中发生未知错误'
    }
  }
}
/**
 * Validate a specific model with the API configuration
 * This is used as final validation when user selects a model
 */
export async function validateApiConfig(config: ApiValidationRequest): Promise<ApiValidationResult> {
  try {
    const startTime = Date.now()

    // Create OpenAI provider instance with custom configuration
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.apiBase.endsWith('/') ? config.apiBase : `${config.apiBase}/`,
    })

    // Make a minimal test request to validate the specific model
    const result = await generateText({
      model: provider(config.model),
      prompt: 'Hello',
      temperature: 0,
    })

    const latency = Date.now() - startTime

    // If we get here, the specific model is working
    return {
      success: true,
      details: {
        latency,
        modelSupported: true,
      }
    }
  } catch (error) {
    console.error('[API Validation] Failed to validate specific model:', error)

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()

      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        return {
          success: false,
          error: '选择的模型不存在或不可用'
        }
      }

      if (errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
        return {
          success: false,
          error: 'API Key无效或权限不足'
        }
      }

      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        return {
          success: false,
          error: 'API请求频率限制，请稍后重试'
        }
      }

      if (errorMessage.includes('quota') || errorMessage.includes('billing')) {
        return {
          success: false,
          error: 'API配额不足或账单问题'
        }
      }

      return {
        success: false,
        error: `模型验证失败: ${error.message}`
      }
    }

    return {
      success: false,
      error: '模型验证过程中发生未知错误'
    }
  }
}

/**
 * Quick validation for common OpenAI-compatible endpoints
 * Returns suggested API base URLs for popular providers
 */
export function suggestApiBase(apiBase: string): string[] {
  const suggestions: string[] = []

  if (!apiBase || apiBase.trim() === '') {
    return [
      'https://api.openai.com/v1',
      'https://api.anthropic.com/v1',
      'https://api.deepseek.com/v1',
    ]
  }

  const base = apiBase.toLowerCase()

  if (base.includes('openai')) {
    suggestions.push('https://api.openai.com/v1')
  }

  if (base.includes('anthropic')) {
    suggestions.push('https://api.anthropic.com/v1')
  }

  if (base.includes('deepseek')) {
    suggestions.push('https://api.deepseek.com/v1')
  }

  // Add the original if it's not already suggested
  if (!suggestions.includes(apiBase)) {
    suggestions.push(apiBase)
  }

  return suggestions
}

/**
 * Validate API base URL format
 */
export function validateApiBaseUrl(apiBase: string): { valid: boolean; error?: string } {
  if (!apiBase || apiBase.trim() === '') {
    return { valid: false, error: 'API Base URL不能为空' }
  }

  try {
    const url = new URL(apiBase)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'API Base URL必须使用HTTP或HTTPS协议' }
    }

    return { valid: true }
  } catch (error) {
    return { valid: false, error: 'API Base URL格式无效' }
  }
}