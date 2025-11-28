# Phase 8: 设置 UI 更新

## 概述

在 API 配置页面添加 Embedding 配置卡片，支持配置 embedding API 和批量回填历史文章。

## 修改文件

### `app/(reader)/settings/api/page.tsx`

在现有的 API 配置页面中，添加 Embedding 配置卡片。

#### 新增状态

```typescript
// 在组件顶部添加状态
const [embeddingFormData, setEmbeddingFormData] = useState({
  apiKey: "",
  apiBase: "",
  model: "",
  dimensions: 1536,
})
const [isValidatingEmbedding, setIsValidatingEmbedding] = useState(false)
const [embeddingValidationResult, setEmbeddingValidationResult] = useState<{
  success: boolean
  models?: string[]
  error?: string
} | null>(null)
const [isBackfilling, setIsBackfilling] = useState(false)
const [backfillProgress, setBackfillProgress] = useState({ current: 0, total: 0 })
```

#### Embedding 配置卡片 UI

在页面的 JSX 中添加：

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Check, AlertCircle, Sparkles, RefreshCw } from "lucide-react"
import { Progress } from "@/components/ui/progress"

// ... 在现有配置卡片后添加 ...

{/* Embedding API 配置卡片 */}
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Sparkles className="h-5 w-5" />
      Embedding 配置
    </CardTitle>
    <CardDescription>
      配置用于语义搜索的 Embedding API（OpenAI 兼容格式）
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* 当前配置显示 */}
    {currentEmbeddingConfig && (
      <div className="rounded-lg border p-3 text-sm">
        <div className="font-medium">当前配置</div>
        <div className="mt-1 text-muted-foreground">
          模型: {currentEmbeddingConfig.model} ({currentEmbeddingConfig.dimensions} 维)
        </div>
      </div>
    )}

    {/* API Key */}
    <div className="space-y-2">
      <Label htmlFor="embedding-api-key">Embedding API Key</Label>
      <Input
        id="embedding-api-key"
        type="password"
        placeholder="sk-..."
        value={embeddingFormData.apiKey}
        onChange={(e) => setEmbeddingFormData(prev => ({
          ...prev,
          apiKey: e.target.value,
        }))}
      />
    </div>

    {/* API Base URL */}
    <div className="space-y-2">
      <Label htmlFor="embedding-api-base">Embedding API Base URL</Label>
      <Input
        id="embedding-api-base"
        type="url"
        placeholder="https://api.openai.com/v1"
        value={embeddingFormData.apiBase}
        onChange={(e) => setEmbeddingFormData(prev => ({
          ...prev,
          apiBase: e.target.value,
        }))}
      />
    </div>

    {/* 验证按钮 */}
    <Button
      variant="outline"
      onClick={handleValidateEmbeddingApi}
      disabled={isValidatingEmbedding || !embeddingFormData.apiKey || !embeddingFormData.apiBase}
    >
      {isValidatingEmbedding ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          验证中...
        </>
      ) : (
        "验证配置"
      )}
    </Button>

    {/* 验证结果 */}
    {embeddingValidationResult && (
      <div className={cn(
        "flex items-center gap-2 rounded-lg p-3 text-sm",
        embeddingValidationResult.success
          ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
      )}>
        {embeddingValidationResult.success ? (
          <Check className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        <span>
          {embeddingValidationResult.success
            ? `验证成功，发现 ${embeddingValidationResult.models?.length || 0} 个 embedding 模型`
            : embeddingValidationResult.error}
        </span>
      </div>
    )}

    {/* 模型选择（验证成功后显示）*/}
    {embeddingValidationResult?.success && embeddingValidationResult.models && (
      <>
        <div className="space-y-2">
          <Label htmlFor="embedding-model">选择模型</Label>
          <Select
            value={embeddingFormData.model}
            onValueChange={(value) => {
              setEmbeddingFormData(prev => ({
                ...prev,
                model: value,
                dimensions: getDefaultDimensions(value),
              }))
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择 embedding 模型" />
            </SelectTrigger>
            <SelectContent>
              {embeddingValidationResult.models.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 维度配置 */}
        <div className="space-y-2">
          <Label htmlFor="embedding-dimensions">向量维度</Label>
          <Input
            id="embedding-dimensions"
            type="number"
            min={128}
            max={4096}
            value={embeddingFormData.dimensions}
            onChange={(e) => setEmbeddingFormData(prev => ({
              ...prev,
              dimensions: parseInt(e.target.value) || 1536,
            }))}
          />
          <p className="text-xs text-muted-foreground">
            根据模型自动设置，通常不需要修改
          </p>
        </div>

        {/* 保存按钮 */}
        <Button
          onClick={handleSaveEmbeddingConfig}
          disabled={!embeddingFormData.model}
        >
          保存配置
        </Button>
      </>
    )}
  </CardContent>
</Card>

{/* 批量生成 Embedding 卡片 */}
{currentEmbeddingConfig && (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <RefreshCw className="h-5 w-5" />
        批量生成 Embedding
      </CardTitle>
      <CardDescription>
        为历史文章生成 embedding 向量，使其可被语义搜索
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-green-600">{embeddingStats.completed}</div>
          <div className="text-xs text-muted-foreground">已完成</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-yellow-600">{embeddingStats.pending}</div>
          <div className="text-xs text-muted-foreground">待处理</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-2xl font-bold text-red-600">{embeddingStats.failed}</div>
          <div className="text-xs text-muted-foreground">失败</div>
        </div>
      </div>

      {/* 进度条（处理中显示）*/}
      {isBackfilling && (
        <div className="space-y-2">
          <Progress value={(backfillProgress.current / backfillProgress.total) * 100} />
          <p className="text-center text-sm text-muted-foreground">
            {backfillProgress.current} / {backfillProgress.total}
          </p>
        </div>
      )}

      {/* 批量生成按钮 */}
      <Button
        onClick={handleBackfillEmbeddings}
        disabled={isBackfilling || embeddingStats.pending === 0}
        className="w-full"
      >
        {isBackfilling ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            生成中...
          </>
        ) : (
          <>
            <RefreshCw className="mr-2 h-4 w-4" />
            为 {embeddingStats.pending + embeddingStats.failed} 篇文章生成 Embedding
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground">
        注意：批量生成会调用 Embedding API，可能产生费用
      </p>
    </CardContent>
  </Card>
)}
```

#### 处理函数

```typescript
import { validateEmbeddingApi, getDefaultDimensions } from "@/lib/embedding"
import { getArticlesPendingEmbedding, updateArticleEmbedding } from "@/lib/db/articles"
import { getEmbeddingStats } from "@/lib/db/search"
import { generateArticleEmbedding } from "@/lib/embedding"

// 验证 Embedding API
const handleValidateEmbeddingApi = async () => {
  setIsValidatingEmbedding(true)
  setEmbeddingValidationResult(null)

  try {
    const result = await validateEmbeddingApi(
      embeddingFormData.apiKey,
      embeddingFormData.apiBase
    )
    setEmbeddingValidationResult(result)

    if (result.success && result.models && result.models.length > 0) {
      // 自动选择第一个模型
      const firstModel = result.models[0]
      setEmbeddingFormData(prev => ({
        ...prev,
        model: firstModel,
        dimensions: getDefaultDimensions(firstModel),
      }))
    }
  } catch (error) {
    setEmbeddingValidationResult({
      success: false,
      error: error instanceof Error ? error.message : '验证失败',
    })
  } finally {
    setIsValidatingEmbedding(false)
  }
}

// 保存 Embedding 配置
const handleSaveEmbeddingConfig = async () => {
  // 找到默认配置或第一个配置
  const targetConfig = apiConfigs.find(c => c.isDefault) || apiConfigs[0]

  if (!targetConfig) {
    // 如果没有配置，提示用户先创建一个
    toast.error("请先创建一个 API 配置")
    return
  }

  // 更新配置
  updateApiConfig(targetConfig.id, {
    embeddingApiKey: embeddingFormData.apiKey,
    embeddingApiBase: embeddingFormData.apiBase,
    embeddingModel: embeddingFormData.model,
    embeddingDimensions: embeddingFormData.dimensions,
  })

  toast.success("Embedding 配置已保存")

  // 重置表单
  setEmbeddingFormData({ apiKey: "", apiBase: "", model: "", dimensions: 1536 })
  setEmbeddingValidationResult(null)

  // 刷新统计
  loadEmbeddingStats()
}

// 批量生成 Embedding
const handleBackfillEmbeddings = async () => {
  setIsBackfilling(true)

  try {
    const articles = await getArticlesPendingEmbedding(100)
    setBackfillProgress({ current: 0, total: articles.length })

    const config = getEmbeddingConfig()
    if (!config) {
      toast.error("未配置 Embedding API")
      return
    }

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]

      try {
        const embedding = await generateArticleEmbedding(
          { title: article.title, content: article.content },
          config
        )
        await updateArticleEmbedding(article.id, embedding, 'completed')
      } catch (error) {
        console.error(`Failed to generate embedding for ${article.id}:`, error)
        await updateArticleEmbedding(article.id, null, 'failed')
      }

      setBackfillProgress({ current: i + 1, total: articles.length })

      // 延迟避免 rate limiting
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    toast.success(`已为 ${articles.length} 篇文章生成 Embedding`)
  } catch (error) {
    console.error("Backfill failed:", error)
    toast.error("批量生成失败")
  } finally {
    setIsBackfilling(false)
    loadEmbeddingStats()
  }
}

// 加载统计信息
const [embeddingStats, setEmbeddingStats] = useState({
  total: 0,
  completed: 0,
  pending: 0,
  failed: 0,
})

const loadEmbeddingStats = async () => {
  try {
    const stats = await getEmbeddingStats()
    setEmbeddingStats(stats)
  } catch (error) {
    console.error("Failed to load embedding stats:", error)
  }
}

// 组件加载时获取统计
useEffect(() => {
  loadEmbeddingStats()
}, [])

// 获取当前 embedding 配置
const currentEmbeddingConfig = useMemo(() => {
  const config = apiConfigs.find(c => c.isDefault) || apiConfigs[0]
  if (!config?.embeddingApiKey || !config?.embeddingModel) return null
  return {
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions || 1536,
  }
}, [apiConfigs])
```

## 功能说明

### Embedding 配置流程

1. 输入 API Key 和 Base URL
2. 点击"验证配置"获取可用模型
3. 选择 embedding 模型
4. （可选）调整向量维度
5. 点击"保存配置"

### 批量回填流程

1. 显示当前 embedding 统计
2. 点击"批量生成"按钮
3. 显示进度条
4. 完成后刷新统计

### 状态展示

| 状态 | 含义 |
|------|------|
| 已完成 | embedding 已生成 |
| 待处理 | 等待生成（新文章或首次运行）|
| 失败 | 生成失败（可重试）|

## 下一步

完成设置 UI 后，继续 [Phase 9: Sidebar 导航更新](./09-sidebar-navigation.md)
