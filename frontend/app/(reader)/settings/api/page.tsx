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
import { Trash2, Edit, Plus, CheckCircle, XCircle, Loader2, Power } from "lucide-react"
import { validateApiConfig, validateApiBaseUrl } from "@/lib/api-validation"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"

const TAB_TYPES: { type: ApiConfigType; placeholder: string }[] = [
  { type: "chat", placeholder: "https://api.openai.com/v1/chat/completions" },
  { type: "embedding", placeholder: "https://api.openai.com/v1/embeddings" },
  { type: "rerank", placeholder: "dashscope" },
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
  const [formData, setFormData] = useState<FormData>(emptyForm)
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    success: boolean
    error?: string
    latency?: number
  } | null>(null)

  const { toast } = useToast()
  const t = useTranslations("settings.api")

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

  // Trim all form fields
  const getTrimmedFormData = () => ({
    name: formData.name.trim(),
    apiKey: formData.apiKey.trim(),
    apiBase: formData.apiBase.trim(),
    model: formData.model.trim(),
  })

  const handleValidate = async () => {
    const trimmed = getTrimmedFormData()

    if (!trimmed.apiKey || !trimmed.apiBase || !trimmed.model) {
      toast({
        title: t("toasts.error"),
        description: t("toasts.fillFieldsBeforeValidation"),
        variant: "destructive",
      })
      return
    }

    const urlValidation = validateApiBaseUrl(trimmed.apiBase)
    if (!urlValidation.valid) {
      toast({
        title: t("toasts.apiBaseUrlError"),
        description: urlValidation.error,
        variant: "destructive",
      })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await validateApiConfig({
        apiKey: trimmed.apiKey,
        apiBase: trimmed.apiBase,
        model: trimmed.model,
        type: activeTab,
      })

      setValidationResult({
        success: result.success,
        error: result.error,
        latency: result.details?.latency,
      })

      if (result.success) {
        toast({
          title: t("toasts.validationSuccess"),
          description: result.details?.latency
            ? t("toasts.modelAvailable", { model: trimmed.model, latency: result.details.latency })
            : t("toasts.modelValidationSuccess"),
        })
      } else {
        toast({
          title: t("toasts.validationFailed"),
          description: result.error || t("toasts.modelValidationFailed"),
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Validation error:", error)
      setValidationResult({
        success: false,
        error: error instanceof Error ? error.message : t("toasts.unknownValidationError"),
      })
      toast({
        title: t("toasts.validationFailed"),
        description: t("toasts.validationNetworkError"),
        variant: "destructive",
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleAdd = async () => {
    const trimmed = getTrimmedFormData()

    if (!trimmed.name || !trimmed.apiKey || !trimmed.apiBase || !trimmed.model) {
      toast({ title: t("toasts.error"), description: t("toasts.fillAllFields"), variant: "destructive" })
      return
    }

    if (!validationResult?.success) {
      toast({ title: t("toasts.error"), description: t("toasts.validateFirst"), variant: "destructive" })
      return
    }

    try {
      await addApiConfig({
        name: trimmed.name,
        apiKey: trimmed.apiKey,
        apiBase: trimmed.apiBase,
        model: trimmed.model,
        type: activeTab,
        isActive: apiConfigsGrouped[activeTab].length === 0,
      })
      resetForm()
      toast({ title: t("toasts.success"), description: t("toasts.configAdded") })
    } catch (error) {
      toast({
        title: t("toasts.error"),
        description: error instanceof Error ? error.message : t("toasts.addConfigFailed"),
        variant: "destructive",
      })
    }
  }

  const handleEdit = async () => {
    if (!editingConfig) return

    const trimmed = getTrimmedFormData()

    if (!trimmed.name || !trimmed.apiKey || !trimmed.apiBase || !trimmed.model) {
      toast({ title: t("toasts.error"), description: t("toasts.fillAllFields"), variant: "destructive" })
      return
    }

    if (!validationResult?.success) {
      toast({ title: t("toasts.error"), description: t("toasts.validateFirst"), variant: "destructive" })
      return
    }

    try {
      await updateApiConfig(editingConfig.id, {
        name: trimmed.name,
        apiKey: trimmed.apiKey,
        apiBase: trimmed.apiBase,
        model: trimmed.model,
      })
      resetForm()
      setEditingConfig(null)
      setIsEditDialogOpen(false)
      toast({ title: t("toasts.success"), description: t("toasts.configUpdated") })
    } catch (error) {
      toast({
        title: t("toasts.error"),
        description: error instanceof Error ? error.message : t("toasts.updateConfigFailed"),
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteApiConfig(id)
      toast({ title: t("toasts.success"), description: t("toasts.configDeleted") })
    } catch (error) {
      toast({
        title: t("toasts.error"),
        description: error instanceof Error ? error.message : t("toasts.deleteConfigFailed"),
        variant: "destructive",
      })
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await activateApiConfig(id)
      toast({ title: t("toasts.success"), description: t("toasts.configActivated") })
    } catch (error) {
      toast({
        title: t("toasts.error"),
        description: error instanceof Error ? error.message : t("toasts.activateConfigFailed"),
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
        <Label>{t("validation.label")}</Label>
        <div className="flex flex-col items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={isValidating || !formData.apiKey || !formData.apiBase || !formData.model}
          >
            {isValidating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("validation.validating")}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("validation.label")}
              </>
            )}
          </Button>
          {(!formData.apiKey || !formData.apiBase || !formData.model) && (
            <p className="text-xs text-muted-foreground">{t("validation.fillFieldsHint")}</p>
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
                <div className="font-medium">{t("validation.success")}</div>
                {validationResult.latency && (
                  <div className="text-xs opacity-75">{t("validation.latency", { latency: validationResult.latency })}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <div>
                <div className="font-medium">{t("validation.failed")}</div>
                <div className="text-xs">{validationResult.error}</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  const renderModelField = (idPrefix: string, type?: ApiConfigType) => {
    const currentType = type || activeTab
    const noticeKey = `tabNotices.${currentType}` as Parameters<typeof t>[0]
    const notice = t.has(noticeKey) ? t(noticeKey) : null

    return (
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-model`}>
          {t("form.model")} <span className="text-red-500">*</span>
        </Label>
        <Input
          id={`${idPrefix}-model`}
          value={formData.model}
          onChange={(e) => {
            setFormData((prev) => ({ ...prev, model: e.target.value }))
            if (validationResult) setValidationResult(null)
          }}
          placeholder={t("form.modelPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">
          {t("form.modelHint")}
          {notice && (
            <span className="text-amber-600 dark:text-amber-400">
              {notice}
            </span>
          )}
        </p>
      </div>
    )
  }

  const renderConfigList = (type: ApiConfigType) => {
    const configs = apiConfigsGrouped[type]

    if (configs.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <p className="text-muted-foreground mb-2">{t("empty.noConfig", { type: t(`tabs.${type}`) })}</p>
            <p className="text-sm text-muted-foreground text-center">{t("empty.addFirstHint")}</p>
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
                    {t("configCard.active")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!config.isActive && (
                  <Button variant="outline" size="sm" onClick={() => handleActivate(config.id)} title={t("configCard.activateTitle")}>
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
                  <span className="font-medium">{t("configCard.modelLabel")}</span>
                  <span className="text-muted-foreground">{config.model}</span>
                </div>
                <div>
                  <span className="font-medium">{t("configCard.apiBaseLabel")}</span>
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
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ApiConfigType)}>
        <TabsList className="grid w-full grid-cols-3">
          {TAB_TYPES.map((tab) => (
            <TabsTrigger key={tab.type} value={tab.type}>
              {t(`tabs.${tab.type}`)}
              {apiConfigsGrouped[tab.type].length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {apiConfigsGrouped[tab.type].length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_TYPES.map((tab) => (
          <TabsContent key={tab.type} value={tab.type} className="space-y-6">
            {/* Add Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  {t("form.addConfig", { type: t(`tabs.${tab.type}`) })}
                </CardTitle>
                <CardDescription>{t(`tabDescriptions.${tab.type}`)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-name`}>
                    {t("form.name")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-name`}
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("form.namePlaceholder")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-apiKey`}>
                    {t("form.apiKey")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-apiKey`}
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={t("form.apiKeyPlaceholder")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`add-${tab.type}-apiBase`}>
                    {t("form.apiBaseUrl")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-${tab.type}-apiBase`}
                    value={formData.apiBase}
                    onChange={(e) => setFormData((prev) => ({ ...prev, apiBase: e.target.value }))}
                    placeholder={tab.placeholder}
                  />
                  <p className="text-xs text-muted-foreground">{t(`tabHints.${tab.type}`)}</p>
                </div>

                {renderModelField(`add-${tab.type}`)}
                {renderValidationSection()}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={resetForm}>
                    {t("form.reset")}
                  </Button>
                  <Button
                    onClick={handleAdd}
                    disabled={
                      !formData.name || !formData.apiKey || !formData.apiBase || !validationResult?.success || !formData.model
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t("form.addConfigButton")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Config List */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{t("form.existingConfigs")}</h2>
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
            <DialogTitle>{t("editDialog.title")}</DialogTitle>
            <DialogDescription>{t("editDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">
                {t("form.name")} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t("form.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiKey">
                {t("form.apiKey")} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-apiKey"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={t("form.apiKeyPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiBase">
                {t("form.apiBaseUrl")} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-apiBase"
                value={formData.apiBase}
                onChange={(e) => setFormData((prev) => ({ ...prev, apiBase: e.target.value }))}
                placeholder={TAB_TYPES.find((t) => t.type === editingConfig?.type)?.placeholder || "https://api.openai.com/v1/chat/completions"}
              />
              <p className="text-xs text-muted-foreground">
                {editingConfig?.type ? t(`tabHints.${editingConfig.type}`) : t("form.apiBaseHintFallback")}
              </p>
            </div>

            {renderModelField("edit", editingConfig?.type)}
            {renderValidationSection()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              {t("editDialog.cancel")}
            </Button>
            <Button
              onClick={handleEdit}
              disabled={!formData.name || !formData.apiKey || !formData.apiBase || !validationResult?.success || !formData.model}
            >
              {t("editDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
