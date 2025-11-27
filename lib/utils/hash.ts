/**
 * Content hashing utilities for article deduplication
 * Uses Web Crypto API for SHA-256 hashing
 */

/**
 * Compute SHA-256 hash of a string
 * @param text - Input text to hash
 * @returns Hex-encoded hash string (64 characters)
 */
async function sha256(text: string): Promise<string> {
  // Convert string to Uint8Array
  const encoder = new TextEncoder()
  const data = encoder.encode(text)

  // Compute SHA-256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)

  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

  return hashHex
}

/**
 * Compute content hash for article deduplication
 * Hash is computed from (title + content) to detect duplicate articles
 *
 * @param title - Article title
 * @param content - Article content (full text or summary)
 * @returns SHA-256 hash string (64 chars hex), or null if inputs are empty
 *
 * @example
 * const hash = await computeContentHash("My Article", "Article content here...")
 * // Returns: "a3b2c1d4e5f6..."
 */
export async function computeContentHash(
  title: string,
  content: string
): Promise<string | null> {
  // Normalize inputs: trim whitespace and convert to lowercase
  const normalizedTitle = title.trim().toLowerCase()
  const normalizedContent = content.trim().toLowerCase()

  // Return null if both are empty (invalid article)
  if (!normalizedTitle && !normalizedContent) {
    return null
  }

  // Concatenate title and content with separator
  const combined = `${normalizedTitle}|||${normalizedContent}`

  // Compute and return hash
  return await sha256(combined)
}

/**
 * Batch compute content hashes for multiple articles
 * @param articles - Array of { title, content } objects
 * @returns Array of hashes in same order (null for invalid articles)
 */
export async function batchComputeContentHash(
  articles: Array<{ title: string; content: string }>
): Promise<Array<string | null>> {
  return await Promise.all(
    articles.map(({ title, content }) => computeContentHash(title, content))
  )
}
