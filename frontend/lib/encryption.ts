/**
 * AES-GCM Encryption/Decryption for API keys and sensitive data
 * Reference: LobeChat's KeyVaultsGateKeeper implementation
 */

import { logger } from "./logger"

/**
 * Get encryption key from environment variable
 * CRITICAL: This must be a 32-character random string
 * Generate with: openssl rand -base64 32
 */
function getEncryptionKey(): string {
  const key = process.env.NEXT_PUBLIC_ENCRYPTION_SECRET || process.env.ENCRYPTION_SECRET

  if (!key) {
    throw new Error(
      'ENCRYPTION_SECRET is not set. Generate one with: openssl rand -base64 32'
    )
  }

  if (key.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be at least 32 characters')
  }

  return key
}

/**
 * Convert string to Uint8Array
 */
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Convert Uint8Array to string
 */
function uint8ArrayToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr)
}

/**
 * Derive a crypto key from the encryption secret
 */
async function deriveKey(): Promise<CryptoKey> {
  const secret = getEncryptionKey()
  const keyMaterial = stringToUint8Array(secret)

  // Import raw key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial.slice(0, 32), // Use first 32 bytes
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  // Derive AES-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: stringToUint8Array('rssreader-salt'), // Fixed salt for deterministic key derivation
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a plaintext string using AES-GCM
 * Returns base64-encoded string: iv:ciphertext
 */
export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return ''

  try {
    const key = await deriveKey()
    const iv = crypto.getRandomValues(new Uint8Array(12)) // 12 bytes for GCM
    const encoded = stringToUint8Array(plaintext)

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    )

    // Combine IV and ciphertext, encode as base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.length)

    const encrypted = Buffer.from(combined).toString('base64')
    logger.debug({ plaintextLength: plaintext.length, encryptedLength: encrypted.length }, 'Data encrypted')
    return encrypted
  } catch (error) {
    logger.error({ error, plaintextLength: plaintext.length }, 'Encryption failed')
    throw new Error('Encryption failed')
  }
}

/**
 * Decrypt a base64-encoded encrypted string
 * Input format: base64(iv:ciphertext)
 */
export async function decrypt(encryptedData: string): Promise<string> {
  if (!encryptedData) return ''

  try {
    const key = await deriveKey()
    const combined = Buffer.from(encryptedData, 'base64')

    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )

    const plaintext = uint8ArrayToString(new Uint8Array(decrypted))
    logger.debug({ encryptedLength: encryptedData.length, decryptedLength: plaintext.length }, 'Data decrypted')
    return plaintext
  } catch (error) {
    logger.error({ error, encryptedLength: encryptedData.length }, 'Decryption failed')
    throw new Error('Decryption failed')
  }
}

/**
 * Check if a string is encrypted (base64 format check)
 */
export function isEncrypted(data: string): boolean {
  if (!data) return false

  // Basic check: valid base64 and reasonable length
  try {
    const decoded = Buffer.from(data, 'base64')
    return decoded.length > 12 // At least IV length
  } catch {
    return false
  }
}

/**
 * Validate encryption secret is properly configured
 */
export function validateEncryptionSecret(): { valid: boolean; error?: string } {
  try {
    const key = process.env.NEXT_PUBLIC_ENCRYPTION_SECRET || process.env.ENCRYPTION_SECRET

    if (!key) {
      return {
        valid: false,
        error: 'ENCRYPTION_SECRET not configured. Generate with: openssl rand -base64 32'
      }
    }

    if (key.length < 32) {
      return {
        valid: false,
        error: `ENCRYPTION_SECRET too short (${key.length} chars). Must be at least 32 characters.`
      }
    }

    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
