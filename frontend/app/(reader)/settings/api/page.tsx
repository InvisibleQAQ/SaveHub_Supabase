"use client"

import { useState, useEffect, useRef } from "react"
import { useRSSStore } from "@/lib/store"
import type { ApiConfig, ApiConfigType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Combobox } from "@/components/ui/combobox"
import { Trash2, Edit, Plus, CheckCircle, XCircle, Loader2, Power } from "lucide-react"
import { validateApiCredentials, validateApiBaseUrl } from "@/lib/api-validation"
import { useToast } from "@/hooks/use-toast"

const TAB_CONFIG: { type: ApiConfigType; label: string; description: string }[] = [
  { type: "chat", label: "Chat API", description: "用于AI对话和文章摘要" },
  { type: "embedding", label: "Embedding API", description: "用于文本向量化和语义搜索" },
  { type: "rerank", label: "Rerank API", description: "用于搜索结果重排序" },
]

interface FormData {
  name: string
  apiKey: string
  apiBase: string
  model: string
}

const emptyForm: FormData = {
  name: "",
  apiKey: "",
  apiBase: "",
  model: "",
}

export default function ApiConfigPage() {
  const {
    apiConfigsGrouped,
    addApiConfig,
    updateApiConfig,
    deleteApiConfig,
    activateApiConfig,
    loadApiConfigsFromSupabase,
  } = useRSSStore()

  const [activeTab, setActiveTab] = useState<ApiConfigType>("chat")
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null)

  // Form state
  const [formData, setFormData] = useState<FormData>(emptyForm)

  // Validation state
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    success: boolean
    error?: string
    latency?: number
    models?: string[]
  } | null>(null)

  const { toast } = useToast()

  // Prevent duplicate loading on remount
  const hasLoadedRef = useRef(false)

  // Load configs on mount only (once)
  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    loadApiConfigsFromSupabase()
  }, [loadApiConfigsFromSupabase])

  const resetForm = () => {
    setFormData(emptyForm)
    setValidationResult(null)
  }

  const handleValidate = async () => {
    if (!formData.apiKey || !formData.apiBase) {
      toast({
        title: "错误",
        description: "请填写API Key和API Base URL后再验证",
        variant: "destructive",
      })
      return
    }

    const urlValidation = validateApiBaseUrl(formData.apiBase)
    if (!urlValidation.valid) {
      toast({
        title: "API Base URL错误",
        description: urlValidation.error,
        variant: "destructive",
      })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await validateApiCredentials({
        apiKey: formData.apiKey,
        apiBase: formData.apiBase,
      })

      setValidationResult({
        success: result.success,
        error: result.error,
        latency: result.details?.latency,
        models: result.models,
      })

      if (result.success) {
        toast({
          title: "验证成功",
          description: result.details?.latency
            ? `API配置有效，响应时间: ${result.details.latency}ms${result.models ? `，找到${result.models.length}个可用模型` : ""}`
            : "API配置验证成功",
        })
      } else {
        toast({
          title: "验证失败",
          description: result.error || "API配置验证失败",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Validation error:", error)
      setValidationResult({
        success: false,
        error: error instanceof Error ? error.message : "验证过程中发生未知错误",
      })
      toast({
        title: "验证失败",
        description: "验证过程中发生错误，请检查网络连接",
        variant: "destructive",
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleAdd = async () => {
    if (!formData.name || !formData.apiKey || !formData.apiBase || !formData.model) {
      toast({
        title: "错误",
        description: "请填写所有必填字段",
        variant: "destructive",
      })
      return
    }

    if (!validationResult?.success) {
      toast({
        title: "错误",
        description: "请先验证API配置",
        variant: "destructive",
      })
      return
    }

    try {
      await addApiConfig({
        name: formData.name,
        apiKey: formData.apiKey,
        apiBase: formData.apiBase,
        model: formData.model,
        type: activeTab,
        isActive: apiConfigsGrouped[activeTab].length === 0, // First config is auto-active
      })
      resetForm()
      toast({
        title: "成功",
        description: "API配置已添加",
      })
    } catch (error) {
      toast({
        title: "错误",
        description: error instanceof Error ? error.message : "添加配置失败",
        variant: "destructive",
      })
    }
  }

  const handleEdit = async () => {
    if (!editingConfig) return

    if (!formData.name || !formData.apiKey || !formData.apiBase || !formData.model) {
      toast({
        title: "错误",
        description: "请填写所有必填字段",
        variant: "destructive",
      })
      return
    }

    if (!validationResult?.success) {
      toast({
        title: "错误",
        description: "请先验证API配置",
        variant: "destructive",
      })
      return
    }

    try {
      await updateApiConfig(editingConfig.id, {
        name: formData.name,
        apiKey: formData.apiKey,
        apiBase: formData.apiBase,
        model: formData.model,
      })
      resetForm()
      setEditingConfig(null)
      setIsEditDialogOpen(false)
      toast({
        title: "成功",
        description: "API配置已更新",
      })
    } catch (error) {
      toast({
        title: "错误",
        description: error instanceof Error ? error.message : "更新配置失败",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteApiConfig(id)
      toast({
        title: "成功",
        description: "API配置已删除",
      })
    } catch (error) {
      toast({
        title: "错误",
        description: error instanceof Error ? error.message : "删除配置失败",
        variant: "destructive",
      })
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await activateApiConfig(id)
      toast({
        title: "成功",
        description: "配置已激活",
      })
    } catch (error) {
      toast({
        title: "错误",
        description: error instanceof Error ? error.message : "激活配置失败",
        variant: "destructive",
      })
    }
  }

  const startEdit = (config: ApiConfig) => {
    setEditingConfig(config)
    setFormData({
      name: config.name,
      apiKey: config.apiKey,
      apiBase: config.apiBase,
      model: config.model,
    })
    setValidationResult(null)
    setIsEditDialogOpen(true)
  }

  const renderValidationSection = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>验证API配置</Label>
        <div className="flex flex-col items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={isValidating || !formData.apiKey || !formData.apiBase}
          >
            {isValidating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                验证中...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                验证配置
              </>
            )}
          </Button>
          {(!formData.apiKey || !formData.apiBase) && (
            <p className="text-xs text-muted-foreground">请填写API Key和API Base URL后验证</p>
          )}
        </div>
      </div>

      {validationResult && (
        <div
          className={`flex items-center gap-2 p-3 rounded-md text-sm ${
            validationResult.success
              ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800"
          }`}
        >
          {validationResult.success ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <div>
                <div className="font-medium">验证成功</div>
                {validationResult.latency && (
                  <div className="text-xs opacity-75">响应时间: {validationResult.latency}ms</div>
                )}
              </div>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <div>
                <div className="font-medium">验证失败</div>
                <div className="text-xs">{validationResult.error}</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  const renderModelField = (idPrefix: string) => {
    if (!validationResult?.success) return null

    return (
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-model`}>
          模型 <span className="text-red-500">*</span>
        </Label>
        {validationResult.models && validationResult.models.length > 0 ? (
          <>
            <Combobox
              options={validationResult.models.map((model) => ({
                value: model,
                label: model,
              }))}
              value={formData.model}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, model: value }))}
              placeholder="输入或选择模型"
              searchPlaceholder="搜索或输入模型名称..."
              emptyText="未找到匹配的模型，直接输入即可"
            />
            <p className="text-xs text-muted-foreground">
              从验证的API中找到 {validationResult.models.length} 个可用模型，您也可以输入自定义模型名称
            </p>
          </>
        ) : (
          <Input
            id={`${idPrefix}-model`}
            value={formData.model}
            onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
            placeholder="gpt-3.5-turbo"
          />
        )}
      </div>
    )
  }

  const renderConfigList = (type: ApiConfigType) => {
    const configs = apiConfigsGrouped[type]

    if (configs.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <p className="text-muted-foreground mb-2">还没有{TAB_CONFIG.find((t) => t.type === type)?.label}配置</p>
            <p className="text-sm text-muted-foreground text-center">请在上方表单中添加您的第一个配置</p>
          </CardContent>
        </Card>
      )
    }

    return (
      <div className="space-y-3">
        {configs.map((config) => (
          <Card key={config.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{config.name}</CardTitle>
                {config.isActive && (
                  <Badge variant="default" className="bg-green-600">
                    已激活
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!config.isActive && (
                  <Button variant="outline" size="sm" onClick={() => handleActivate(config.id)} title="激活此配置">
                    <Power className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => startEdit(config)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDelete(config.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="font-medium">模型: </span>
                  <span className="text-muted-foreground">{config.model}</span>
                </div>
                <div>
                  <span className="font-medium">API Base: </span>
                  <span className="text-muted-foreground">{config.apiBase}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API配置</h1>
        <p className="text-muted-foreground">管理您的AI API配置，每种类型可设置多个配置，但只能激活一个</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ApiConfigType)}>
        <TabsList className="grid w-full grid-cols-3">
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger key={tab.type} value={tab.type}>
              {tab.label}
              {apiConfigsGrouped[tab.type].length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {apiConfigsGrouped[tab.type].length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_CONFIG.map((tab) => (
          <TabsContent key={tab.type} value={tab.type} className="space-y-6">
            {/* Add Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  添加{tab.label}配置
                </CardTitle>
                <CardDescription>{tab.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-name`}>
                    名称 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-name`}
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="配置名称"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-apiKey`}>
                    API Key <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-apiKey`}
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="your-api-key"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-apiBase`}>
                    API Base URL <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-apiBase`}
                    value={formData.apiBase}
                    onChange={(e) => setFormData((prev) => ({ ...prev, apiBase: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                {renderValidationSection()}
                {renderModelField(`add-${tab.type}`)}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={resetForm}>
                    重置
                  </Button>
                  <Button
                    onClick={handleAdd}
                    disabled={
                      !formData.name || !formData.apiKey || !formData.apiBase || !validationResult?.success || !formData.model
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    添加配置
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Config List */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">现有配置</h2>
              {renderConfigList(tab.type)}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit Dialog */}
      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open)
          if (!open) {
            setValidationResult(null)
            setEditingConfig(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑API配置</DialogTitle>
            <DialogDescription>修改API配置信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">
                名称 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="配置名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiKey">
                API Key <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-apiKey"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="your-api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiBase">
                API Base URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-apiBase"
                value={formData.apiBase}
                onChange={(e) => setFormData((prev) => ({ ...prev, apiBase: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            {renderValidationSection()}
            {renderModelField("edit")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleEdit}
              disabled={!formData.name || !formData.apiKey || !formData.apiBase || !validationResult?.success || !formData.model}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
