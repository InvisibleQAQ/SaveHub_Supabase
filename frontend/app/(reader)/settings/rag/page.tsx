"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Gauge, Rocket, ShieldCheck } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useRSSStore } from "@/lib/store"

type Ranges = {
  min: number
  max: number
  step?: number
}

const CORE_RANGES = {
  topK: { min: 1, max: 30, step: 1 },
  minScore: { min: 0, max: 1, step: 0.01 },
  maxSplitQuestions: { min: 1, max: 6, step: 1 },
  maxToolRounds: { min: 1, max: 8, step: 1 },
  maxExpandCalls: { min: 0, max: 6, step: 1 },
  maxToolRetry: { min: 0, max: 3, step: 1 },
  answerMaxTokens: { min: 200, max: 2200, step: 10 },
} as const

const ADVANCED_RANGES = {
  historySummaryTemperature: { min: 0, max: 1, step: 0.05 },
  historySummaryMaxTokens: { min: 32, max: 1024, step: 8 },
  queryAnalysisTemperature: { min: 0, max: 1, step: 0.05 },
  queryAnalysisMaxTokens: { min: 64, max: 2048, step: 8 },
  answerGenerationTemperature: { min: 0, max: 1, step: 0.05 },
  aggregationTemperature: { min: 0, max: 1, step: 0.05 },
  expandContextWindowSize: { min: 0, max: 8, step: 1 },
  expandContextTopKMin: { min: 1, max: 20, step: 1 },
  expandContextMinScoreDelta: { min: -1, max: 1, step: 0.01 },
  retrySearchMinScoreDelta: { min: -1, max: 1, step: 0.01 },
  seedSourceLimit: { min: 1, max: 20, step: 1 },
  finalizeMinSources: { min: 1, max: 20, step: 1 },
  finalizeMinHighConfidence: { min: 1, max: 10, step: 1 },
  evidenceMaxSources: { min: 1, max: 30, step: 1 },
  evidenceSnippetMaxChars: { min: 80, max: 2000, step: 10 },
  sourceContentMaxChars: { min: 100, max: 4000, step: 50 },
} as const

function clamp(value: number, range: Ranges): number {
  const stepped = range.step ? Math.round(value / range.step) * range.step : value
  const bounded = Math.min(range.max, Math.max(range.min, stepped))
  if ((range.step ?? 1) < 1) {
    return Number(bounded.toFixed(4))
  }
  return bounded
}

function NumberInputRow({
  label,
  description,
  rangeTip,
  meaningTip,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  description: string
  rangeTip: string
  meaningTip: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Label>{label}</Label>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="text-xs text-muted-foreground">{rangeTip}</p>
          <p className="text-xs text-muted-foreground">{meaningTip}</p>
        </div>
        <Input
          type="number"
          className="w-32"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => {
            const parsed = Number(e.target.value)
            if (!Number.isFinite(parsed)) return
            const clamped = clamp(parsed, { min, max, step })
            onChange(clamped)
          }}
        />
      </div>
    </div>
  )
}

function PresetCard({
  icon,
  title,
  subtitle,
  onApply,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onApply: () => void
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      className="w-full rounded-md border p-3 text-left hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
        </div>
      </div>
    </button>
  )
}

export default function RagSettingsPage() {
  const { settings, updateSettings } = useRSSStore()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const coreScorePercent = useMemo(
    () => Math.round(settings.agenticRagMinScore * 100),
    [settings.agenticRagMinScore]
  )

  const applyFastPreset = () => {
    updateSettings({
      agenticRagTopK: 6,
      agenticRagMinScore: 0.45,
      agenticRagMaxSplitQuestions: 2,
      agenticRagMaxToolRoundsPerQuestion: 2,
      agenticRagMaxExpandCallsPerQuestion: 1,
      agenticRagRetryToolOnFailure: true,
      agenticRagMaxToolRetry: 1,
      agenticRagAnswerMaxTokens: 700,
    })
  }

  const applyBalancedPreset = () => {
    updateSettings({
      agenticRagTopK: 8,
      agenticRagMinScore: 0.35,
      agenticRagMaxSplitQuestions: 3,
      agenticRagMaxToolRoundsPerQuestion: 3,
      agenticRagMaxExpandCallsPerQuestion: 2,
      agenticRagRetryToolOnFailure: true,
      agenticRagMaxToolRetry: 1,
      agenticRagAnswerMaxTokens: 900,
    })
  }

  const applyDeepPreset = () => {
    updateSettings({
      agenticRagTopK: 12,
      agenticRagMinScore: 0.25,
      agenticRagMaxSplitQuestions: 4,
      agenticRagMaxToolRoundsPerQuestion: 5,
      agenticRagMaxExpandCallsPerQuestion: 3,
      agenticRagRetryToolOnFailure: true,
      agenticRagMaxToolRetry: 2,
      agenticRagAnswerMaxTokens: 1300,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Agentic RAG</h1>
        <p className="text-muted-foreground mt-2">给非技术用户也能看懂的 RAG 配置面板</p>
      </div>

      <div className="rounded-md border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
          <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p>建议先用下方“快速预设”，再按体验微调 1～2 个核心参数。</p>
            <p>如果你不确定，直接使用“平衡（推荐）”通常效果最好。</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Label>快速预设（小白推荐）</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PresetCard
            icon={<Rocket className="h-4 w-4" />}
            title="快速"
            subtitle="响应更快，成本更低，但可能漏掉部分边缘信息"
            onApply={applyFastPreset}
          />
          <PresetCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title="平衡（推荐）"
            subtitle="速度与质量均衡，适合大多数日常问答"
            onApply={applyBalancedPreset}
          />
          <PresetCard
            icon={<Gauge className="h-4 w-4" />}
            title="深入"
            subtitle="检索更广、回答更长，但速度更慢，消耗更高"
            onApply={applyDeepPreset}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rag-top-k">检索文档数量 (Top K)</Label>
            <span className="text-sm text-muted-foreground font-medium">{settings.agenticRagTopK}</span>
          </div>
          <Slider
            id="rag-top-k"
            min={CORE_RANGES.topK.min}
            max={CORE_RANGES.topK.max}
            step={CORE_RANGES.topK.step}
            value={[settings.agenticRagTopK]}
            onValueChange={([value]) =>
              updateSettings({
                agenticRagTopK: clamp(value, CORE_RANGES.topK),
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            范围 {CORE_RANGES.topK.min}～{CORE_RANGES.topK.max}，推荐 6～12。
            调大：信息更全但更慢；调小：更快但可能漏信息。
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rag-min-score">最小相似度阈值</Label>
            <span className="text-sm text-muted-foreground font-medium">
              {settings.agenticRagMinScore.toFixed(2)} ({coreScorePercent}%)
            </span>
          </div>
          <Slider
            id="rag-min-score"
            min={CORE_RANGES.minScore.min}
            max={CORE_RANGES.minScore.max}
            step={CORE_RANGES.minScore.step}
            value={[settings.agenticRagMinScore]}
            onValueChange={([value]) =>
              updateSettings({
                agenticRagMinScore: clamp(value, CORE_RANGES.minScore),
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            范围 0～1，推荐 0.30～0.45。调大更严格（更准但可能查不到），调小更宽松（更全但噪音变多）。
          </p>
        </div>

        <NumberInputRow
          label="最多拆分子问题数"
          description="复杂问题会先拆解后分别检索"
          rangeTip={`范围 ${CORE_RANGES.maxSplitQuestions.min}～${CORE_RANGES.maxSplitQuestions.max}，推荐 2～4`}
          meaningTip="调大：覆盖面更广但更慢；调小：更快但可能回答不完整"
          value={settings.agenticRagMaxSplitQuestions}
          min={CORE_RANGES.maxSplitQuestions.min}
          max={CORE_RANGES.maxSplitQuestions.max}
          step={CORE_RANGES.maxSplitQuestions.step}
          onChange={(value) => updateSettings({ agenticRagMaxSplitQuestions: value })}
        />

        <NumberInputRow
          label="每个子问题最大工具轮次"
          description="每个子问题允许检索/扩展多少轮"
          rangeTip={`范围 ${CORE_RANGES.maxToolRounds.min}～${CORE_RANGES.maxToolRounds.max}，推荐 2～4`}
          meaningTip="调大：能补充更多证据但更慢；调小：响应更快"
          value={settings.agenticRagMaxToolRoundsPerQuestion}
          min={CORE_RANGES.maxToolRounds.min}
          max={CORE_RANGES.maxToolRounds.max}
          step={CORE_RANGES.maxToolRounds.step}
          onChange={(value) => updateSettings({ agenticRagMaxToolRoundsPerQuestion: value })}
        />

        <NumberInputRow
          label="每个子问题最大扩展次数"
          description="初次检索不足时，允许追加检索次数"
          rangeTip={`范围 ${CORE_RANGES.maxExpandCalls.min}～${CORE_RANGES.maxExpandCalls.max}，推荐 1～3`}
          meaningTip="调大：可减少漏答但更慢；调小：更省时"
          value={settings.agenticRagMaxExpandCallsPerQuestion}
          min={CORE_RANGES.maxExpandCalls.min}
          max={CORE_RANGES.maxExpandCalls.max}
          step={CORE_RANGES.maxExpandCalls.step}
          onChange={(value) => updateSettings({ agenticRagMaxExpandCallsPerQuestion: value })}
        />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="rag-retry-on-failure">工具失败自动重试</Label>
            <p className="text-sm text-muted-foreground">遇到偶发网络波动时更稳</p>
            <p className="text-xs text-muted-foreground">建议开启。关闭后偶发失败会直接影响回答完整度。</p>
          </div>
          <Switch
            id="rag-retry-on-failure"
            checked={settings.agenticRagRetryToolOnFailure}
            onCheckedChange={(checked) => updateSettings({ agenticRagRetryToolOnFailure: checked })}
          />
        </div>

        {settings.agenticRagRetryToolOnFailure && (
          <NumberInputRow
            label="工具最大重试次数"
            description="单次失败后再尝试的次数"
            rangeTip={`范围 ${CORE_RANGES.maxToolRetry.min}～${CORE_RANGES.maxToolRetry.max}，推荐 1～2`}
            meaningTip="调大：稳定性更高但更慢；调小：更快"
            value={settings.agenticRagMaxToolRetry}
            min={CORE_RANGES.maxToolRetry.min}
            max={CORE_RANGES.maxToolRetry.max}
            step={CORE_RANGES.maxToolRetry.step}
            onChange={(value) => updateSettings({ agenticRagMaxToolRetry: value })}
          />
        )}

        <NumberInputRow
          label="回答最大输出 Tokens"
          description="限制最终回答长度（越大可写越长）"
          rangeTip={`范围 ${CORE_RANGES.answerMaxTokens.min}～${CORE_RANGES.answerMaxTokens.max}，推荐 700～1300`}
          meaningTip="调大：回答更详细但更慢；调小：更简短更快"
          value={settings.agenticRagAnswerMaxTokens}
          min={CORE_RANGES.answerMaxTokens.min}
          max={CORE_RANGES.answerMaxTokens.max}
          step={CORE_RANGES.answerMaxTokens.step}
          onChange={(value) => updateSettings({ agenticRagAnswerMaxTokens: value })}
        />
      </div>

      <Separator />

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            <span>高级参数与提示词（进阶）</span>
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-6 border rounded-md p-4">
          <div className="rounded-md border border-muted p-3 text-xs text-muted-foreground">
            这些参数适合进阶调优。若你不确定作用，建议保持默认值。修改前可先记录当前值，便于回滚。
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInputRow
              label="摘要温度"
              description="历史摘要生成随机性"
              rangeTip={`范围 ${ADVANCED_RANGES.historySummaryTemperature.min}～${ADVANCED_RANGES.historySummaryTemperature.max}`}
              meaningTip="越高越发散，越低越稳定"
              value={settings.agenticRagHistorySummaryTemperature}
              min={ADVANCED_RANGES.historySummaryTemperature.min}
              max={ADVANCED_RANGES.historySummaryTemperature.max}
              step={ADVANCED_RANGES.historySummaryTemperature.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagHistorySummaryTemperature: clamp(value, ADVANCED_RANGES.historySummaryTemperature),
                })
              }
            />
            <NumberInputRow
              label="摘要最大 Tokens"
              description="历史摘要输出上限"
              rangeTip={`范围 ${ADVANCED_RANGES.historySummaryMaxTokens.min}～${ADVANCED_RANGES.historySummaryMaxTokens.max}`}
              meaningTip="越大越详细，越小越简短"
              value={settings.agenticRagHistorySummaryMaxTokens}
              min={ADVANCED_RANGES.historySummaryMaxTokens.min}
              max={ADVANCED_RANGES.historySummaryMaxTokens.max}
              step={ADVANCED_RANGES.historySummaryMaxTokens.step}
              onChange={(value) => updateSettings({ agenticRagHistorySummaryMaxTokens: value })}
            />
            <NumberInputRow
              label="查询分析温度"
              description="问题拆分随机性"
              rangeTip={`范围 ${ADVANCED_RANGES.queryAnalysisTemperature.min}～${ADVANCED_RANGES.queryAnalysisTemperature.max}`}
              meaningTip="越高拆分更灵活，越低更保守"
              value={settings.agenticRagQueryAnalysisTemperature}
              min={ADVANCED_RANGES.queryAnalysisTemperature.min}
              max={ADVANCED_RANGES.queryAnalysisTemperature.max}
              step={ADVANCED_RANGES.queryAnalysisTemperature.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagQueryAnalysisTemperature: clamp(value, ADVANCED_RANGES.queryAnalysisTemperature),
                })
              }
            />
            <NumberInputRow
              label="查询分析最大 Tokens"
              description="分析结果长度上限"
              rangeTip={`范围 ${ADVANCED_RANGES.queryAnalysisMaxTokens.min}～${ADVANCED_RANGES.queryAnalysisMaxTokens.max}`}
              meaningTip="越大可输出更多结构信息"
              value={settings.agenticRagQueryAnalysisMaxTokens}
              min={ADVANCED_RANGES.queryAnalysisMaxTokens.min}
              max={ADVANCED_RANGES.queryAnalysisMaxTokens.max}
              step={ADVANCED_RANGES.queryAnalysisMaxTokens.step}
              onChange={(value) => updateSettings({ agenticRagQueryAnalysisMaxTokens: value })}
            />
            <NumberInputRow
              label="答案生成温度"
              description="子答案随机性"
              rangeTip={`范围 ${ADVANCED_RANGES.answerGenerationTemperature.min}～${ADVANCED_RANGES.answerGenerationTemperature.max}`}
              meaningTip="越高文风更活，但稳定性下降"
              value={settings.agenticRagAnswerGenerationTemperature}
              min={ADVANCED_RANGES.answerGenerationTemperature.min}
              max={ADVANCED_RANGES.answerGenerationTemperature.max}
              step={ADVANCED_RANGES.answerGenerationTemperature.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagAnswerGenerationTemperature: clamp(value, ADVANCED_RANGES.answerGenerationTemperature),
                })
              }
            />
            <NumberInputRow
              label="聚合温度"
              description="最终答案聚合随机性"
              rangeTip={`范围 ${ADVANCED_RANGES.aggregationTemperature.min}～${ADVANCED_RANGES.aggregationTemperature.max}`}
              meaningTip="建议保持低值，减少跳脱"
              value={settings.agenticRagAggregationTemperature}
              min={ADVANCED_RANGES.aggregationTemperature.min}
              max={ADVANCED_RANGES.aggregationTemperature.max}
              step={ADVANCED_RANGES.aggregationTemperature.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagAggregationTemperature: clamp(value, ADVANCED_RANGES.aggregationTemperature),
                })
              }
            />
            <NumberInputRow
              label="上下文扩展窗口"
              description="邻近 chunk 扩展半径"
              rangeTip={`范围 ${ADVANCED_RANGES.expandContextWindowSize.min}～${ADVANCED_RANGES.expandContextWindowSize.max}`}
              meaningTip="越大召回越全，但噪音可能增加"
              value={settings.agenticRagExpandContextWindowSize}
              min={ADVANCED_RANGES.expandContextWindowSize.min}
              max={ADVANCED_RANGES.expandContextWindowSize.max}
              step={ADVANCED_RANGES.expandContextWindowSize.step}
              onChange={(value) => updateSettings({ agenticRagExpandContextWindowSize: value })}
            />
            <NumberInputRow
              label="扩展检索最小 Top K"
              description="二次扩展最少检索条数"
              rangeTip={`范围 ${ADVANCED_RANGES.expandContextTopKMin.min}～${ADVANCED_RANGES.expandContextTopKMin.max}`}
              meaningTip="越大更全面，越小更快"
              value={settings.agenticRagExpandContextTopKMin}
              min={ADVANCED_RANGES.expandContextTopKMin.min}
              max={ADVANCED_RANGES.expandContextTopKMin.max}
              step={ADVANCED_RANGES.expandContextTopKMin.step}
              onChange={(value) => updateSettings({ agenticRagExpandContextTopKMin: value })}
            />
            <NumberInputRow
              label="扩展检索分数偏移"
              description="扩展时对 min_score 的加减"
              rangeTip={`范围 ${ADVANCED_RANGES.expandContextMinScoreDelta.min}～${ADVANCED_RANGES.expandContextMinScoreDelta.max}`}
              meaningTip="负值=更宽松，正值=更严格"
              value={settings.agenticRagExpandContextMinScoreDelta}
              min={ADVANCED_RANGES.expandContextMinScoreDelta.min}
              max={ADVANCED_RANGES.expandContextMinScoreDelta.max}
              step={ADVANCED_RANGES.expandContextMinScoreDelta.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagExpandContextMinScoreDelta: clamp(value, ADVANCED_RANGES.expandContextMinScoreDelta),
                })
              }
            />
            <NumberInputRow
              label="重试检索分数偏移"
              description="重试时对 min_score 的加减"
              rangeTip={`范围 ${ADVANCED_RANGES.retrySearchMinScoreDelta.min}～${ADVANCED_RANGES.retrySearchMinScoreDelta.max}`}
              meaningTip="通常保持负值即可"
              value={settings.agenticRagRetrySearchMinScoreDelta}
              min={ADVANCED_RANGES.retrySearchMinScoreDelta.min}
              max={ADVANCED_RANGES.retrySearchMinScoreDelta.max}
              step={ADVANCED_RANGES.retrySearchMinScoreDelta.step}
              onChange={(value) =>
                updateSettings({
                  agenticRagRetrySearchMinScoreDelta: clamp(value, ADVANCED_RANGES.retrySearchMinScoreDelta),
                })
              }
            />
            <NumberInputRow
              label="种子来源上限"
              description="二次扩展参考的种子条数"
              rangeTip={`范围 ${ADVANCED_RANGES.seedSourceLimit.min}～${ADVANCED_RANGES.seedSourceLimit.max}`}
              meaningTip="越大越全，但更慢"
              value={settings.agenticRagSeedSourceLimit}
              min={ADVANCED_RANGES.seedSourceLimit.min}
              max={ADVANCED_RANGES.seedSourceLimit.max}
              step={ADVANCED_RANGES.seedSourceLimit.step}
              onChange={(value) => updateSettings({ agenticRagSeedSourceLimit: value })}
            />
            <NumberInputRow
              label="收敛最小来源数"
              description="达到该来源数量可提前收敛"
              rangeTip={`范围 ${ADVANCED_RANGES.finalizeMinSources.min}～${ADVANCED_RANGES.finalizeMinSources.max}`}
              meaningTip="越大越谨慎，越小越快"
              value={settings.agenticRagFinalizeMinSources}
              min={ADVANCED_RANGES.finalizeMinSources.min}
              max={ADVANCED_RANGES.finalizeMinSources.max}
              step={ADVANCED_RANGES.finalizeMinSources.step}
              onChange={(value) => updateSettings({ agenticRagFinalizeMinSources: value })}
            />
            <NumberInputRow
              label="收敛高置信证据数"
              description="高分证据达到此值可收敛"
              rangeTip={`范围 ${ADVANCED_RANGES.finalizeMinHighConfidence.min}～${ADVANCED_RANGES.finalizeMinHighConfidence.max}`}
              meaningTip="越大越稳，越小更快"
              value={settings.agenticRagFinalizeMinHighConfidence}
              min={ADVANCED_RANGES.finalizeMinHighConfidence.min}
              max={ADVANCED_RANGES.finalizeMinHighConfidence.max}
              step={ADVANCED_RANGES.finalizeMinHighConfidence.step}
              onChange={(value) => updateSettings({ agenticRagFinalizeMinHighConfidence: value })}
            />
            <NumberInputRow
              label="证据引用最大条数"
              description="单子答案最大证据条数"
              rangeTip={`范围 ${ADVANCED_RANGES.evidenceMaxSources.min}～${ADVANCED_RANGES.evidenceMaxSources.max}`}
              meaningTip="越大更全面，越小更简洁"
              value={settings.agenticRagEvidenceMaxSources}
              min={ADVANCED_RANGES.evidenceMaxSources.min}
              max={ADVANCED_RANGES.evidenceMaxSources.max}
              step={ADVANCED_RANGES.evidenceMaxSources.step}
              onChange={(value) => updateSettings({ agenticRagEvidenceMaxSources: value })}
            />
            <NumberInputRow
              label="证据片段最大字符"
              description="每条证据最多保留的字符"
              rangeTip={`范围 ${ADVANCED_RANGES.evidenceSnippetMaxChars.min}～${ADVANCED_RANGES.evidenceSnippetMaxChars.max}`}
              meaningTip="越大信息更全，但提示词更长"
              value={settings.agenticRagEvidenceSnippetMaxChars}
              min={ADVANCED_RANGES.evidenceSnippetMaxChars.min}
              max={ADVANCED_RANGES.evidenceSnippetMaxChars.max}
              step={ADVANCED_RANGES.evidenceSnippetMaxChars.step}
              onChange={(value) => updateSettings({ agenticRagEvidenceSnippetMaxChars: value })}
            />
            <NumberInputRow
              label="来源内容最大字符"
              description="检索结果 content 最大长度"
              rangeTip={`范围 ${ADVANCED_RANGES.sourceContentMaxChars.min}～${ADVANCED_RANGES.sourceContentMaxChars.max}`}
              meaningTip="越大细节更多，但计算更慢"
              value={settings.agenticRagSourceContentMaxChars}
              min={ADVANCED_RANGES.sourceContentMaxChars.min}
              max={ADVANCED_RANGES.sourceContentMaxChars.max}
              step={ADVANCED_RANGES.sourceContentMaxChars.step}
              onChange={(value) => updateSettings({ agenticRagSourceContentMaxChars: value })}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">提示词建议先小幅修改（10%以内），逐步观察回答变化。</div>

            <div className="space-y-2">
              <Label htmlFor="prompt-query-analysis">查询分析 System Prompt</Label>
              <Textarea
                id="prompt-query-analysis"
                className="min-h-[160px]"
                value={settings.agenticRagQueryAnalysisSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagQueryAnalysisSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-clarification">澄清提示词</Label>
              <Textarea
                id="prompt-clarification"
                className="min-h-[100px]"
                value={settings.agenticRagClarificationPrompt}
                onChange={(e) => updateSettings({ agenticRagClarificationPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-answer-generation">答案生成 System Prompt</Label>
              <Textarea
                id="prompt-answer-generation"
                className="min-h-[160px]"
                value={settings.agenticRagAnswerGenerationSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagAnswerGenerationSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-aggregation">聚合 System Prompt</Label>
              <Textarea
                id="prompt-aggregation"
                className="min-h-[160px]"
                value={settings.agenticRagAggregationSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagAggregationSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-history-system">历史摘要 System Prompt</Label>
              <Textarea
                id="prompt-history-system"
                className="min-h-[100px]"
                value={settings.agenticRagHistorySummarySystemPrompt}
                onChange={(e) => updateSettings({ agenticRagHistorySummarySystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-history-user-template">历史摘要 User Prompt 模板</Label>
              <Textarea
                id="prompt-history-user-template"
                className="min-h-[130px]"
                value={settings.agenticRagHistorySummaryUserPromptTemplate}
                onChange={(e) => updateSettings({ agenticRagHistorySummaryUserPromptTemplate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-no-kb">无知识库兜底文案</Label>
              <Input
                id="prompt-no-kb"
                value={settings.agenticRagNoKbAnswer}
                onChange={(e) => updateSettings({ agenticRagNoKbAnswer: e.target.value })}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

