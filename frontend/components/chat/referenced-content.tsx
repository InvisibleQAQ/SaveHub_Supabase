"use client"

import { useMemo } from "react"
import { ReferenceMarker } from "./reference-marker"
import { parseReferences } from "@/lib/reference-parser"
import type { RetrievedSource } from "@/lib/api/agentic-rag"

interface ReferencedContentProps {
  content: string
  sources: RetrievedSource[]
}

export function ReferencedContent({ content, sources }: ReferencedContentProps) {
  // 构建索引到 source 的映射
  const sourceMap = useMemo(() => {
    const map = new Map<number, RetrievedSource>()
    sources.forEach((s) => map.set(s.index, s))
    return map
  }, [sources])

  // 解析引用标记
  const maxSourceIndex = useMemo(() => {
    return sources.reduce((max, source) => Math.max(max, source.index || 0), 0)
  }, [sources])

  const { segments } = useMemo(() => {
    return parseReferences(content, maxSourceIndex)
  }, [content, maxSourceIndex])

  // 渲染片段
  const renderSegments = () => {
    return segments.map((segment, i) => {
      if (segment.type === "reference" && segment.refIndex) {
        const source = sourceMap.get(segment.refIndex)
        if (source) {
          return (
            <ReferenceMarker
              key={`ref-${i}`}
              index={segment.refIndex}
              source={source}
            />
          )
        }
      }

      // 文本片段 - 保留换行
      return (
        <span key={`text-${i}`} className="whitespace-pre-wrap">
          {segment.content}
        </span>
      )
    })
  }

  return (
    <div className="text-sm leading-relaxed">
      {renderSegments()}
    </div>
  )
}
