import type { ApiConfigType } from './types'
import { fetchWithAuth } from './api/fetch-client'

const API_BASE = '/api/backend/api-configs'

export interface ApiValidationRequest {
  apiKey: string
  apiBase: string
  model: string
  type?: ApiConfigType  // 'chat' | 'embedding' | 'rerank'
}

export interface ApiValidationResult {
  success: boolean
  error?: string
  details?: {
    latency?: number
    modelSupported?: boolean
  }
}

/**
 * Validate a specific model with the API configuration
 * Calls backend API which uses LangChain for validation
 */
export async function validateApiConfig(config: ApiValidationRequest): Promise<ApiValidationResult> {
  const type = config.type || 'chat'

  try {
    const response = await fetchWithAuth(`${API_BASE}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: config.apiKey,
        api_base: config.apiBase,
        model: config.model,
        type: type,
      }),
    })

    if (!response.ok) {
      // Handle HTTP errors from backend
      if (response.status === 401) {
        return {
          success: false,
          error: '请先登录后再验证API配置'
        }
      }
      const errorText = await response.text()
      return {
        success: false,
        error: `服务器错误: ${response.status} - ${errorText.slice(0, 100)}`
      }
    }

    const result = await response.json()

    return {
      success: result.success,
      error: result.error,
      details: result.details ? {
        latency: result.details.latency,
        modelSupported: result.details.model_supported,
      } : undefined,
    }

  } catch (error) {
    console.error('[API Validation] Failed to validate model:', error)

    if (error instanceof Error) {
      // Handle session expired error from fetchWithAuth
      if (error.message === 'Session expired') {
        return {
          success: false,
          error: '会话已过期，请重新登录'
        }
      }

      if (error.message.includes('fetch') || error.message.includes('network')) {
        return {
          success: false,
          error: '无法连接到验证服务器，请检查网络连接'
        }
      }

      return {
        success: false,
        error: `验证失败: ${error.message}`
      }
    }

    return {
      success: false,
      error: '模型验证过程中发生未知错误'
    }
  }
}

/**
 * Validate API endpoint URL format (client-side only)
 * Special case: "dashscope" is valid for DashScope rerank API
 */
export function validateApiBaseUrl(apiBase: string): { valid: boolean; error?: string } {
  if (!apiBase || apiBase.trim() === '') {
    return { valid: false, error: 'API 端点 URL不能为空' }
  }

  // Special case: DashScope SDK identifier
  if (apiBase.trim().toLowerCase() === 'dashscope') {
    return { valid: true }
  }

  try {
    const url = new URL(apiBase)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'API 端点 URL必须使用HTTP或HTTPS协议' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'API 端点 URL格式无效' }
  }
}
