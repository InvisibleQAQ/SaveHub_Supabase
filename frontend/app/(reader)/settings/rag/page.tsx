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
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

type PresetKey = "fast" | "balanced" | "deep"

type PresetConfig = {
  agenticRagTopK: number
  agenticRagMinScore: number
  agenticRagMaxSplitQuestions: number
  agenticRagMaxToolRoundsPerQuestion: number
  agenticRagMaxExpandCallsPerQuestion: number
  agenticRagRetryToolOnFailure: boolean
  agenticRagMaxToolRetry: number
  agenticRagAnswerMaxTokens: number
}

const PRESET_CONFIGS: Record<PresetKey, PresetConfig> = {
  fast: {
    agenticRagTopK: 8,
    agenticRagMinScore: 0.38,
    agenticRagMaxSplitQuestions: 2,
    agenticRagMaxToolRoundsPerQuestion: 3,
    agenticRagMaxExpandCallsPerQuestion: 2,
    agenticRagRetryToolOnFailure: true,
    agenticRagMaxToolRetry: 1,
    agenticRagAnswerMaxTokens: 800,
  },
  balanced: {
    agenticRagTopK: 12,
    agenticRagMinScore: 0.3,
    agenticRagMaxSplitQuestions: 3,
    agenticRagMaxToolRoundsPerQuestion: 4,
    agenticRagMaxExpandCallsPerQuestion: 3,
    agenticRagRetryToolOnFailure: true,
    agenticRagMaxToolRetry: 2,
    agenticRagAnswerMaxTokens: 1100,
  },
  deep: {
    agenticRagTopK: 16,
    agenticRagMinScore: 0.2,
    agenticRagMaxSplitQuestions: 5,
    agenticRagMaxToolRoundsPerQuestion: 6,
    agenticRagMaxExpandCallsPerQuestion: 4,
    agenticRagRetryToolOnFailure: true,
    agenticRagMaxToolRetry: 3,
    agenticRagAnswerMaxTokens: 1500,
  },
}

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
  selected,
  selectedLabel,
  onApply,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  selected: boolean
  selectedLabel: string
  onApply: () => void
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-md border p-3 text-left transition-all duration-150 ease-out will-change-transform motion-safe:active:scale-[0.98]",
        selected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30 shadow-sm"
          : "hover:bg-muted/40 hover:border-primary/20"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5 text-muted-foreground", selected && "text-primary")}>{icon}</div>
          <div>
            <div className={cn("font-medium", selected && "text-primary")}>{title}</div>
            <div className={cn("mt-1 text-xs text-muted-foreground", selected && "text-primary/80")}>{subtitle}</div>
          </div>
        </div>
        {selected && (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {selectedLabel}
          </span>
        )}
      </div>
    </button>
  )
}

export default function RagSettingsPage() {
  const { settings, updateSettings } = useRSSStore()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const t = useTranslations("settings.rag")

  const coreScorePercent = useMemo(
    () => Math.round(settings.agenticRagMinScore * 100),
    [settings.agenticRagMinScore]
  )

  const isCurrentPreset = (preset: PresetConfig) => {
    const scoreTolerance = 0.0001
    return (
      settings.agenticRagTopK === preset.agenticRagTopK &&
      Math.abs(settings.agenticRagMinScore - preset.agenticRagMinScore) < scoreTolerance &&
      settings.agenticRagMaxSplitQuestions === preset.agenticRagMaxSplitQuestions &&
      settings.agenticRagMaxToolRoundsPerQuestion === preset.agenticRagMaxToolRoundsPerQuestion &&
      settings.agenticRagMaxExpandCallsPerQuestion === preset.agenticRagMaxExpandCallsPerQuestion &&
      settings.agenticRagRetryToolOnFailure === preset.agenticRagRetryToolOnFailure &&
      settings.agenticRagMaxToolRetry === preset.agenticRagMaxToolRetry &&
      settings.agenticRagAnswerMaxTokens === preset.agenticRagAnswerMaxTokens
    )
  }

  const activePreset = useMemo<PresetKey | null>(() => {
    if (isCurrentPreset(PRESET_CONFIGS.fast)) return "fast"
    if (isCurrentPreset(PRESET_CONFIGS.balanced)) return "balanced"
    if (isCurrentPreset(PRESET_CONFIGS.deep)) return "deep"
    return null
  }, [
    settings.agenticRagTopK,
    settings.agenticRagMinScore,
    settings.agenticRagMaxSplitQuestions,
    settings.agenticRagMaxToolRoundsPerQuestion,
    settings.agenticRagMaxExpandCallsPerQuestion,
    settings.agenticRagRetryToolOnFailure,
    settings.agenticRagMaxToolRetry,
    settings.agenticRagAnswerMaxTokens,
  ])

  const applyFastPreset = () => {
    updateSettings(PRESET_CONFIGS.fast)
  }

  const applyBalancedPreset = () => {
    updateSettings(PRESET_CONFIGS.balanced)
  }

  const applyDeepPreset = () => {
    updateSettings(PRESET_CONFIGS.deep)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("description")}</p>
      </div>

      <div className="rounded-md border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
          <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p>{t("alertLine1")}</p>
            <p>{t("alertLine2")}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Label>{t("presets.label")}</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PresetCard
            icon={<Rocket className="h-4 w-4" />}
            title={t("presets.fast")}
            subtitle={t("presets.fastDescription")}
            selected={activePreset === "fast"}
            selectedLabel={t("presets.selected")}
            onApply={applyFastPreset}
          />
          <PresetCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title={t("presets.balanced")}
            subtitle={t("presets.balancedDescription")}
            selected={activePreset === "balanced"}
            selectedLabel={t("presets.selected")}
            onApply={applyBalancedPreset}
          />
          <PresetCard
            icon={<Gauge className="h-4 w-4" />}
            title={t("presets.deep")}
            subtitle={t("presets.deepDescription")}
            selected={activePreset === "deep"}
            selectedLabel={t("presets.selected")}
            onApply={applyDeepPreset}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {activePreset ? t("presets.matchedPreset") : t("presets.customParams")}
        </p>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rag-top-k">{t("core.topK")}</Label>
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
            {t("core.topKHint", { min: CORE_RANGES.topK.min, max: CORE_RANGES.topK.max })}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rag-min-score">{t("core.minScore")}</Label>
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
            {t("core.minScoreHint")}
          </p>
        </div>

        <NumberInputRow
          label={t("core.maxSplitQuestions")}
          description={t("core.maxSplitQuestionsDesc")}
          rangeTip={t("core.maxSplitQuestionsRange", { min: CORE_RANGES.maxSplitQuestions.min, max: CORE_RANGES.maxSplitQuestions.max })}
          meaningTip={t("core.maxSplitQuestionsMeaning")}
          value={settings.agenticRagMaxSplitQuestions}
          min={CORE_RANGES.maxSplitQuestions.min}
          max={CORE_RANGES.maxSplitQuestions.max}
          step={CORE_RANGES.maxSplitQuestions.step}
          onChange={(value) => updateSettings({ agenticRagMaxSplitQuestions: value })}
        />

        <NumberInputRow
          label={t("core.maxToolRounds")}
          description={t("core.maxToolRoundsDesc")}
          rangeTip={t("core.maxToolRoundsRange", { min: CORE_RANGES.maxToolRounds.min, max: CORE_RANGES.maxToolRounds.max })}
          meaningTip={t("core.maxToolRoundsMeaning")}
          value={settings.agenticRagMaxToolRoundsPerQuestion}
          min={CORE_RANGES.maxToolRounds.min}
          max={CORE_RANGES.maxToolRounds.max}
          step={CORE_RANGES.maxToolRounds.step}
          onChange={(value) => updateSettings({ agenticRagMaxToolRoundsPerQuestion: value })}
        />

        <NumberInputRow
          label={t("core.maxExpandCalls")}
          description={t("core.maxExpandCallsDesc")}
          rangeTip={t("core.maxExpandCallsRange", { min: CORE_RANGES.maxExpandCalls.min, max: CORE_RANGES.maxExpandCalls.max })}
          meaningTip={t("core.maxExpandCallsMeaning")}
          value={settings.agenticRagMaxExpandCallsPerQuestion}
          min={CORE_RANGES.maxExpandCalls.min}
          max={CORE_RANGES.maxExpandCalls.max}
          step={CORE_RANGES.maxExpandCalls.step}
          onChange={(value) => updateSettings({ agenticRagMaxExpandCallsPerQuestion: value })}
        />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="rag-retry-on-failure">{t("core.retryOnFailure")}</Label>
            <p className="text-sm text-muted-foreground">{t("core.retryOnFailureDesc")}</p>
            <p className="text-xs text-muted-foreground">{t("core.retryOnFailureHint")}</p>
          </div>
          <Switch
            id="rag-retry-on-failure"
            checked={settings.agenticRagRetryToolOnFailure}
            onCheckedChange={(checked) => updateSettings({ agenticRagRetryToolOnFailure: checked })}
          />
        </div>

        {settings.agenticRagRetryToolOnFailure && (
          <NumberInputRow
            label={t("core.maxToolRetry")}
            description={t("core.maxToolRetryDesc")}
            rangeTip={t("core.maxToolRetryRange", { min: CORE_RANGES.maxToolRetry.min, max: CORE_RANGES.maxToolRetry.max })}
            meaningTip={t("core.maxToolRetryMeaning")}
            value={settings.agenticRagMaxToolRetry}
            min={CORE_RANGES.maxToolRetry.min}
            max={CORE_RANGES.maxToolRetry.max}
            step={CORE_RANGES.maxToolRetry.step}
            onChange={(value) => updateSettings({ agenticRagMaxToolRetry: value })}
          />
        )}

        <NumberInputRow
          label={t("core.answerMaxTokens")}
          description={t("core.answerMaxTokensDesc")}
          rangeTip={t("core.answerMaxTokensRange", { min: CORE_RANGES.answerMaxTokens.min, max: CORE_RANGES.answerMaxTokens.max })}
          meaningTip={t("core.answerMaxTokensMeaning")}
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
            <span>{t("advanced.toggle")}</span>
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-6 border rounded-md p-4">
          <div className="rounded-md border border-muted p-3 text-xs text-muted-foreground">
            {t("advanced.note")}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInputRow
              label={t("advanced.summaryTemp")}
              description={t("advanced.summaryTempDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.historySummaryTemperature.min, max: ADVANCED_RANGES.historySummaryTemperature.max })}
              meaningTip={t("advanced.summaryTempMeaning")}
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
              label={t("advanced.summaryMaxTokens")}
              description={t("advanced.summaryMaxTokensDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.historySummaryMaxTokens.min, max: ADVANCED_RANGES.historySummaryMaxTokens.max })}
              meaningTip={t("advanced.summaryMaxTokensMeaning")}
              value={settings.agenticRagHistorySummaryMaxTokens}
              min={ADVANCED_RANGES.historySummaryMaxTokens.min}
              max={ADVANCED_RANGES.historySummaryMaxTokens.max}
              step={ADVANCED_RANGES.historySummaryMaxTokens.step}
              onChange={(value) => updateSettings({ agenticRagHistorySummaryMaxTokens: value })}
            />
            <NumberInputRow
              label={t("advanced.queryTemp")}
              description={t("advanced.queryTempDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.queryAnalysisTemperature.min, max: ADVANCED_RANGES.queryAnalysisTemperature.max })}
              meaningTip={t("advanced.queryTempMeaning")}
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
              label={t("advanced.queryMaxTokens")}
              description={t("advanced.queryMaxTokensDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.queryAnalysisMaxTokens.min, max: ADVANCED_RANGES.queryAnalysisMaxTokens.max })}
              meaningTip={t("advanced.queryMaxTokensMeaning")}
              value={settings.agenticRagQueryAnalysisMaxTokens}
              min={ADVANCED_RANGES.queryAnalysisMaxTokens.min}
              max={ADVANCED_RANGES.queryAnalysisMaxTokens.max}
              step={ADVANCED_RANGES.queryAnalysisMaxTokens.step}
              onChange={(value) => updateSettings({ agenticRagQueryAnalysisMaxTokens: value })}
            />
            <NumberInputRow
              label={t("advanced.answerTemp")}
              description={t("advanced.answerTempDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.answerGenerationTemperature.min, max: ADVANCED_RANGES.answerGenerationTemperature.max })}
              meaningTip={t("advanced.answerTempMeaning")}
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
              label={t("advanced.aggregationTemp")}
              description={t("advanced.aggregationTempDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.aggregationTemperature.min, max: ADVANCED_RANGES.aggregationTemperature.max })}
              meaningTip={t("advanced.aggregationTempMeaning")}
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
              label={t("advanced.expandWindow")}
              description={t("advanced.expandWindowDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.expandContextWindowSize.min, max: ADVANCED_RANGES.expandContextWindowSize.max })}
              meaningTip={t("advanced.expandWindowMeaning")}
              value={settings.agenticRagExpandContextWindowSize}
              min={ADVANCED_RANGES.expandContextWindowSize.min}
              max={ADVANCED_RANGES.expandContextWindowSize.max}
              step={ADVANCED_RANGES.expandContextWindowSize.step}
              onChange={(value) => updateSettings({ agenticRagExpandContextWindowSize: value })}
            />
            <NumberInputRow
              label={t("advanced.expandTopKMin")}
              description={t("advanced.expandTopKMinDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.expandContextTopKMin.min, max: ADVANCED_RANGES.expandContextTopKMin.max })}
              meaningTip={t("advanced.expandTopKMinMeaning")}
              value={settings.agenticRagExpandContextTopKMin}
              min={ADVANCED_RANGES.expandContextTopKMin.min}
              max={ADVANCED_RANGES.expandContextTopKMin.max}
              step={ADVANCED_RANGES.expandContextTopKMin.step}
              onChange={(value) => updateSettings({ agenticRagExpandContextTopKMin: value })}
            />
            <NumberInputRow
              label={t("advanced.expandScoreDelta")}
              description={t("advanced.expandScoreDeltaDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.expandContextMinScoreDelta.min, max: ADVANCED_RANGES.expandContextMinScoreDelta.max })}
              meaningTip={t("advanced.expandScoreDeltaMeaning")}
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
              label={t("advanced.retryScoreDelta")}
              description={t("advanced.retryScoreDeltaDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.retrySearchMinScoreDelta.min, max: ADVANCED_RANGES.retrySearchMinScoreDelta.max })}
              meaningTip={t("advanced.retryScoreDeltaMeaning")}
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
              label={t("advanced.seedSourceLimit")}
              description={t("advanced.seedSourceLimitDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.seedSourceLimit.min, max: ADVANCED_RANGES.seedSourceLimit.max })}
              meaningTip={t("advanced.seedSourceLimitMeaning")}
              value={settings.agenticRagSeedSourceLimit}
              min={ADVANCED_RANGES.seedSourceLimit.min}
              max={ADVANCED_RANGES.seedSourceLimit.max}
              step={ADVANCED_RANGES.seedSourceLimit.step}
              onChange={(value) => updateSettings({ agenticRagSeedSourceLimit: value })}
            />
            <NumberInputRow
              label={t("advanced.finalizeMinSources")}
              description={t("advanced.finalizeMinSourcesDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.finalizeMinSources.min, max: ADVANCED_RANGES.finalizeMinSources.max })}
              meaningTip={t("advanced.finalizeMinSourcesMeaning")}
              value={settings.agenticRagFinalizeMinSources}
              min={ADVANCED_RANGES.finalizeMinSources.min}
              max={ADVANCED_RANGES.finalizeMinSources.max}
              step={ADVANCED_RANGES.finalizeMinSources.step}
              onChange={(value) => updateSettings({ agenticRagFinalizeMinSources: value })}
            />
            <NumberInputRow
              label={t("advanced.finalizeMinHighConf")}
              description={t("advanced.finalizeMinHighConfDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.finalizeMinHighConfidence.min, max: ADVANCED_RANGES.finalizeMinHighConfidence.max })}
              meaningTip={t("advanced.finalizeMinHighConfMeaning")}
              value={settings.agenticRagFinalizeMinHighConfidence}
              min={ADVANCED_RANGES.finalizeMinHighConfidence.min}
              max={ADVANCED_RANGES.finalizeMinHighConfidence.max}
              step={ADVANCED_RANGES.finalizeMinHighConfidence.step}
              onChange={(value) => updateSettings({ agenticRagFinalizeMinHighConfidence: value })}
            />
            <NumberInputRow
              label={t("advanced.evidenceMaxSources")}
              description={t("advanced.evidenceMaxSourcesDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.evidenceMaxSources.min, max: ADVANCED_RANGES.evidenceMaxSources.max })}
              meaningTip={t("advanced.evidenceMaxSourcesMeaning")}
              value={settings.agenticRagEvidenceMaxSources}
              min={ADVANCED_RANGES.evidenceMaxSources.min}
              max={ADVANCED_RANGES.evidenceMaxSources.max}
              step={ADVANCED_RANGES.evidenceMaxSources.step}
              onChange={(value) => updateSettings({ agenticRagEvidenceMaxSources: value })}
            />
            <NumberInputRow
              label={t("advanced.evidenceSnippetMaxChars")}
              description={t("advanced.evidenceSnippetMaxCharsDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.evidenceSnippetMaxChars.min, max: ADVANCED_RANGES.evidenceSnippetMaxChars.max })}
              meaningTip={t("advanced.evidenceSnippetMaxCharsMeaning")}
              value={settings.agenticRagEvidenceSnippetMaxChars}
              min={ADVANCED_RANGES.evidenceSnippetMaxChars.min}
              max={ADVANCED_RANGES.evidenceSnippetMaxChars.max}
              step={ADVANCED_RANGES.evidenceSnippetMaxChars.step}
              onChange={(value) => updateSettings({ agenticRagEvidenceSnippetMaxChars: value })}
            />
            <NumberInputRow
              label={t("advanced.sourceContentMaxChars")}
              description={t("advanced.sourceContentMaxCharsDesc")}
              rangeTip={t("rangeText", { min: ADVANCED_RANGES.sourceContentMaxChars.min, max: ADVANCED_RANGES.sourceContentMaxChars.max })}
              meaningTip={t("advanced.sourceContentMaxCharsMeaning")}
              value={settings.agenticRagSourceContentMaxChars}
              min={ADVANCED_RANGES.sourceContentMaxChars.min}
              max={ADVANCED_RANGES.sourceContentMaxChars.max}
              step={ADVANCED_RANGES.sourceContentMaxChars.step}
              onChange={(value) => updateSettings({ agenticRagSourceContentMaxChars: value })}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">{t("advanced.promptNote")}</div>

            <div className="space-y-2">
              <Label htmlFor="prompt-query-analysis">{t("advanced.queryAnalysisPrompt")}</Label>
              <Textarea
                id="prompt-query-analysis"
                className="min-h-[160px]"
                value={settings.agenticRagQueryAnalysisSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagQueryAnalysisSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-clarification">{t("advanced.clarificationPrompt")}</Label>
              <Textarea
                id="prompt-clarification"
                className="min-h-[100px]"
                value={settings.agenticRagClarificationPrompt}
                onChange={(e) => updateSettings({ agenticRagClarificationPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-answer-generation">{t("advanced.answerGenerationPrompt")}</Label>
              <Textarea
                id="prompt-answer-generation"
                className="min-h-[160px]"
                value={settings.agenticRagAnswerGenerationSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagAnswerGenerationSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-aggregation">{t("advanced.aggregationPrompt")}</Label>
              <Textarea
                id="prompt-aggregation"
                className="min-h-[160px]"
                value={settings.agenticRagAggregationSystemPrompt}
                onChange={(e) => updateSettings({ agenticRagAggregationSystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-history-system">{t("advanced.historySummarySystemPrompt")}</Label>
              <Textarea
                id="prompt-history-system"
                className="min-h-[100px]"
                value={settings.agenticRagHistorySummarySystemPrompt}
                onChange={(e) => updateSettings({ agenticRagHistorySummarySystemPrompt: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-history-user-template">{t("advanced.historySummaryUserTemplate")}</Label>
              <Textarea
                id="prompt-history-user-template"
                className="min-h-[130px]"
                value={settings.agenticRagHistorySummaryUserPromptTemplate}
                onChange={(e) => updateSettings({ agenticRagHistorySummaryUserPromptTemplate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-no-kb">{t("advanced.noKbAnswer")}</Label>
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
