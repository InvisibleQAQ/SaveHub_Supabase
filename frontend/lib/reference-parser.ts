/**
 * 引用标记解析器
 *
 * 处理 [ref:N] 格式的引用标记，支持流式渲染时的截断处理
 */

// 圆形数字映射（1-10）
const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]

export interface ParsedSegment {
  type: "text" | "reference"
  content: string
  refIndex?: number // 仅 reference 类型有效
}

/**
 * 获取圆形数字
 */
export function getCircledNumber(index: number): string {
  if (index >= 1 && index <= 10) {
    return CIRCLED_NUMBERS[index - 1]
  }
  return `[${index}]`
}

/**
 * 解析文本中的引用标记
 *
 * @param text 包含 [ref:N] 标记的文本
 * @param maxIndex 最大有效索引（sources 数量）
 * @returns 解析后的片段数组和待处理的不完整标记
 */
export function parseReferences(
  text: string,
  maxIndex: number
): { segments: ParsedSegment[]; pendingText: string } {
  const segments: ParsedSegment[] = []
  const refPattern = /\[ref:(\d+)\]/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = refPattern.exec(text)) !== null) {
    // 添加标记前的文本
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      })
    }

    const refIndex = parseInt(match[1], 10)

    // 验证索引有效性
    if (refIndex >= 1 && refIndex <= maxIndex) {
      segments.push({
        type: "reference",
        content: getCircledNumber(refIndex),
        refIndex,
      })
    } else {
      // 无效索引，保留原文本
      segments.push({
        type: "text",
        content: match[0],
      })
    }

    lastIndex = match.index + match[0].length
  }

  // 检查末尾是否有未完成的标记（流式截断处理）
  const remaining = text.slice(lastIndex)
  const incompletePattern = /\[ref:?\d*$/
  const incompleteMatch = remaining.match(incompletePattern)

  if (incompleteMatch) {
    // 有未完成的标记，分离出来
    const completeText = remaining.slice(0, incompleteMatch.index)
    if (completeText) {
      segments.push({ type: "text", content: completeText })
    }
    return {
      segments,
      pendingText: incompleteMatch[0], // 返回待处理的不完整标记
    }
  }

  if (remaining) {
    segments.push({ type: "text", content: remaining })
  }

  return { segments, pendingText: "" }
}
