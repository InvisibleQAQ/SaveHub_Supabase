/**
 * 加密/解密工具库
 * 使用 WebCrypto API 进行 AES-GCM 加密
 */

// 派生密钥的参数
const PBKDF2_ITERATIONS = 100000
const KEY_LENGTH = 256
const IV_LENGTH = 12

/**
 * 从用户密码派生加密密钥
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * 加密文本
 */
export async function encryptText(text: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)

  // 生成随机 salt 和 IV
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  // 派生密钥
  const key = await deriveKey(password, salt)

  // 加密数据
  const encryptedData = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  )

  // 组合 salt + iv + encryptedData
  const combined = new Uint8Array(salt.length + iv.length + encryptedData.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(encryptedData), salt.length + iv.length)

  // 转换为 base64
  return btoa(String.fromCharCode(...combined))
}

/**
 * 解密文本
 */
export async function decryptText(encryptedText: string, password: string): Promise<string> {
  try {
    // 从 base64 解码
    const combined = new Uint8Array(
      atob(encryptedText)
        .split('')
        .map(char => char.charCodeAt(0))
    )

    // 提取 salt, iv, encryptedData
    const salt = combined.slice(0, 16)
    const iv = combined.slice(16, 16 + IV_LENGTH)
    const encryptedData = combined.slice(16 + IV_LENGTH)

    // 派生密钥
    const key = await deriveKey(password, salt)

    // 解密数据
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encryptedData
    )

    // 转换为字符串
    const decoder = new TextDecoder()
    return decoder.decode(decryptedData)
  } catch (error) {
    throw new Error('解密失败：密码错误或数据损坏')
  }
}

/**
 * 生成随机密码（用于测试或默认密码）
 */
export function generateRandomPassword(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => chars[byte % chars.length]).join('')
}

/**
 * 验证密码是否可以解密数据
 */
export async function validatePassword(encryptedText: string, password: string): Promise<boolean> {
  try {
    await decryptText(encryptedText, password)
    return true
  } catch {
    return false
  }
}