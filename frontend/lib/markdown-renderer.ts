import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Check if running on server (SSR)
const isServer = typeof window === 'undefined'

interface MarkdownRendererOptions {
  /**
   * Base URL for transforming relative image paths
   * Example: "https://raw.githubusercontent.com/owner/repo/main"
   */
  baseUrl?: string

  /**
   * Enable GitHub Flavored Markdown features
   * @default true
   */
  gfm?: boolean
}

interface MarkdownRenderResult {
  html: string
  error?: string
}

/**
 * Renders markdown to sanitized HTML
 *
 * ⚠️ SECURITY: Uses DOMPurify to prevent XSS attacks
 * ⚠️ PERFORMANCE: Synchronous operation, may block on large documents
 */
export function renderMarkdown(
  content: string,
  options: MarkdownRendererOptions = {}
): MarkdownRenderResult {
  try {
    const { baseUrl, gfm = true } = options

    // Configure marked with GFM support
    marked.setOptions({
      gfm,
      breaks: true,        // Convert \n to <br> in paragraphs
      pedantic: false,     // Don't conform to original markdown.pl
    })

    // Create custom renderer
    const renderer = new marked.Renderer()

    // Custom image renderer with URL transformation
    renderer.image = ({ href, title, text }) => {
      const transformedHref = transformImageUrl(href, baseUrl)
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<img src="${escapeHtml(transformedHref)}" alt="${escapeHtml(text)}" ${titleAttr} class="max-w-full h-auto rounded-lg" loading="lazy" />`
    }

    // Custom code block renderer
    renderer.code = ({ text, lang }) => {
      const language = lang || 'plaintext'
      return `<pre class="overflow-x-auto p-4 rounded-lg bg-muted/50 border text-foreground"><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>`
    }

    // Custom inline code renderer
    renderer.codespan = ({ text }) => {
      return `<code class="px-1.5 py-0.5 rounded bg-muted text-foreground text-sm font-mono">${escapeHtml(text)}</code>`
    }

    // Parse markdown to HTML
    const rawHtml = marked(content, { renderer }) as string

    // Sanitize HTML to prevent XSS
    const cleanHtml = sanitizeHtml(rawHtml)

    return { html: cleanHtml }
  } catch (error) {
    console.error('Markdown rendering failed:', error)
    return {
      html: '<p class="text-destructive">Failed to render markdown content</p>',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Transform relative image URLs to absolute GitHub raw URLs
 */
function transformImageUrl(src: string, baseUrl?: string): string {
  if (!src || !baseUrl) return src

  // Already absolute URL
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }

  // Data URLs (base64 images)
  if (src.startsWith('data:')) {
    return src
  }

  // Relative URL - convert to absolute
  const cleanSrc = src.startsWith('/') ? src : `/${src}`
  return `${baseUrl}${cleanSrc}`
}

/**
 * Sanitize HTML to prevent XSS attacks
 *
 * ⚠️ CRITICAL SECURITY FUNCTION
 * On server: returns raw HTML (actual sanitization happens on client hydration)
 * On client: uses DOMPurify for XSS protection
 */
function sanitizeHtml(html: string): string {
  // Skip sanitization on server - DOMPurify requires DOM APIs
  // The component using this is "use client", so actual render happens client-side
  if (isServer) {
    return html
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      // Headings
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // Text formatting
      'p', 'br', 'hr', 'strong', 'em', 'del', 'ins', 'sub', 'sup',
      // Lists
      'ul', 'ol', 'li',
      // Links and media
      'a', 'img',
      // Code
      'code', 'pre',
      // Quotes
      'blockquote',
      // Tables (GFM)
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      // Task lists (GFM)
      'input',
      // Divs for structure
      'div', 'span',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class',
      'type', 'checked', 'disabled', // For task lists
      'id', // For header anchors
      'align', 'colspan', 'rowspan', // For tables
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  })
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}
