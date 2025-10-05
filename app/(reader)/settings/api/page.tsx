"use client"

import { useState, useEffect } from "react"
import { useRSSStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Combobox } from "@/components/ui/combobox"
import { Trash2, Edit, Plus, Key, Eye, EyeOff, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { setMasterPassword, hasMasterPassword } from "@/lib/db/api-configs"
import { validateApiCredentials, validateApiBaseUrl } from "@/lib/api-validation"
import { useToast } from "@/hooks/use-toast"

export default function ApiConfigPage() {
  const { apiConfigs, addApiConfig, updateApiConfig, deleteApiConfig, setDefaultApiConfig } = useRSSStore()
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<any>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [masterPasswordInput, setMasterPasswordInput] = useState("")
  const [passwordSet, setPasswordSet] = useState(false)

  // API validation states
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    success: boolean
    error?: string
    latency?: number
    models?: string[]
  } | null>(null)

  const { toast } = useToast()

  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    apiBase: "",
    model: "",
    isDefault: false,
    isActive: true,
  })

  useEffect(() => {
    setPasswordSet(hasMasterPassword())
  }, [])

  const resetForm = () => {
    setFormData({
      name: "",
      apiKey: "",
      apiBase: "",
      model: "",
      isDefault: false,
      isActive: true,
    })
    setValidationResult(null)
  }

  const handleValidateApiConfig = async () => {
    if (!formData.apiKey || !formData.apiBase) {
      toast({
        title: "错误",
        description: "请填写API Key和API Base URL后再验证",
        variant: "destructive",
      })
      return
    }

    // Validate API Base URL format first
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
            ? `API配置有效，响应时间: ${result.details.latency}ms${result.models ? `，找到${result.models.length}个可用模型` : ''}`
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
      console.error('Validation error:', error)
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

  const handleSetMasterPassword = () => {
    if (!masterPasswordInput.trim()) {
      toast({
        title: "错误",
        description: "请输入主密码",
        variant: "destructive",
      })
      return
    }

    try {
      setMasterPassword(masterPasswordInput)
      setPasswordSet(true)
      setIsPasswordDialogOpen(false)
      setMasterPasswordInput("")
      toast({
        title: "成功",
        description: "主密码已设置",
      })
    } catch (error) {
      toast({
        title: "错误",
        description: "设置主密码失败",
        variant: "destructive",
      })
    }
  }

  const handleAddConfig = () => {
    if (!passwordSet) {
      setIsPasswordDialogOpen(true)
      return
    }

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

    addApiConfig(formData)
    resetForm()
    toast({
      title: "成功",
      description: "API配置已添加",
    })
  }

  const handleEditConfig = () => {
    if (!editingConfig || !formData.name || !formData.apiKey || !formData.apiBase || !formData.model) {
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

    updateApiConfig(editingConfig.id, formData)
    resetForm()
    setEditingConfig(null)
    setIsEditDialogOpen(false)
    toast({
      title: "成功",
      description: "API配置已更新",
    })
  }

  const handleDeleteConfig = (id: string) => {
    deleteApiConfig(id)
    toast({
      title: "成功",
      description: "API配置已删除",
    })
  }

  const handleSetDefault = (id: string) => {
    setDefaultApiConfig(id)
    toast({
      title: "成功",
      description: "默认配置已更新",
    })
  }

  const startEdit = (config: any) => {
    setEditingConfig(config)
    setFormData({
      name: config.name,
      apiKey: config.apiKey,
      apiBase: config.apiBase,
      model: config.model,
      isDefault: config.isDefault,
      isActive: config.isActive,
    })
    setValidationResult(null)
    setIsEditDialogOpen(true)
  }

  if (!passwordSet) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">API配置</h1>
          <p className="text-muted-foreground">管理您的AI API配置</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              设置主密码
            </CardTitle>
            <CardDescription>
              为了保护您的API密钥安全，请设置一个主密码。这个密码将用于加密您的API配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="master-password">主密码</Label>
              <div className="relative">
                <Input
                  id="master-password"
                  type={showPassword ? "text" : "password"}
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder="输入主密码"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button onClick={handleSetMasterPassword}>设置密码</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API配置</h1>
        <p className="text-muted-foreground">管理您的AI API配置</p>
      </div>

      {/* 添加API配置表单 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            添加新的API配置
          </CardTitle>
          <CardDescription>配置您的AI API以开始使用智能功能</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-name">名称 <span className="text-red-500">*</span></Label>
            <Input
              id="add-name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="配置名称"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-apiKey">API Key <span className="text-red-500">*</span></Label>
            <Input
              id="add-apiKey"
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="your-api-key"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-apiBase">API Base URL <span className="text-red-500">*</span></Label>
            <Input
              id="add-apiBase"
              value={formData.apiBase}
              onChange={(e) => setFormData(prev => ({ ...prev, apiBase: e.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          {/* API 验证区域 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>验证API配置</Label>
              <div className="flex flex-col items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleValidateApiConfig}
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
                  <p className="text-xs text-muted-foreground">
                    请填写API Key和API Base URL后验证
                  </p>
                )}
              </div>
            </div>

            {validationResult && (
              <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
                validationResult.success
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {validationResult.success ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <div>
                      <div className="font-medium">验证成功</div>
                      {validationResult.latency && (
                        <div className="text-xs opacity-75">响应时间: {validationResult.latency}ms</div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <div>
                      <div className="font-medium">验证失败</div>
                      <div className="text-xs">{validationResult.error}</div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 模型选择区域 - 只在验证成功后显示 */}
          {validationResult?.success && (
            <div className="space-y-2">
              <Label htmlFor="add-model">模型 <span className="text-red-500">*</span></Label>
              {validationResult.models && validationResult.models.length > 0 ? (
                <>
                  <Combobox
                    options={validationResult.models.map(model => ({
                      value: model,
                      label: model,
                    }))}
                    value={formData.model}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, model: value }))}
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
                  id="add-model"
                  value={formData.model}
                  onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="gpt-3.5-turbo"
                />
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.isDefault}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
              />
              <Label>设为默认配置</Label>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetForm}>
                重置
              </Button>
              <Button
                onClick={handleAddConfig}
                disabled={
                  !formData.name ||
                  !formData.apiKey ||
                  !formData.apiBase ||
                  !validationResult?.success ||
                  !formData.model
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                添加配置
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 现有配置列表 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">现有配置</h2>
        {apiConfigs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <p className="text-muted-foreground mb-4">还没有API配置</p>
              <p className="text-sm text-muted-foreground text-center">
                请在上方表单中添加您的第一个API配置
              </p>
            </CardContent>
          </Card>
        ) : (
          apiConfigs.map((config) => (
            <Card key={config.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{config.name}</CardTitle>
                  {config.isDefault && <Badge variant="default">默认</Badge>}
                  {!config.isActive && <Badge variant="outline">已禁用</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(config)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteConfig(config.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm font-medium">模型: </span>
                    <span className="text-sm text-muted-foreground">{config.model}</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium">API Base: </span>
                    <span className="text-sm text-muted-foreground">{config.apiBase}</span>
                  </div>
                  <div className="pt-2">
                    {!config.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(config.id)}
                      >
                        设为默认
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open)
        if (!open) {
          setValidationResult(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑API配置</DialogTitle>
            <DialogDescription>修改API配置信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">名称 <span className="text-red-500">*</span></Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="配置名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiKey">API Key <span className="text-red-500">*</span></Label>
              <Input
                id="edit-apiKey"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="your-api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiBase">API Base URL <span className="text-red-500">*</span></Label>
              <Input
                id="edit-apiBase"
                value={formData.apiBase}
                onChange={(e) => setFormData(prev => ({ ...prev, apiBase: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            {/* API 验证区域 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>验证配置</Label>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleValidateApiConfig}
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
                    <p className="text-xs text-muted-foreground">
                      请填写API Key和API Base URL后验证
                    </p>
                  )}
                </div>
              </div>

              {validationResult && (
                <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
                  validationResult.success
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {validationResult.success ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <div>
                        <div className="font-medium">验证成功</div>
                        {validationResult.latency && (
                          <div className="text-xs opacity-75">响应时间: {validationResult.latency}ms</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-600" />
                      <div>
                        <div className="font-medium">验证失败</div>
                        <div className="text-xs">{validationResult.error}</div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 模型选择区域 - 只在验证成功后显示 */}
            {validationResult?.success && (
              <div className="space-y-2">
                <Label htmlFor="edit-model">模型 <span className="text-red-500">*</span></Label>
                {validationResult.models && validationResult.models.length > 0 ? (
                  <>
                    <Combobox
                      options={validationResult.models.map(model => ({
                        value: model,
                        label: model,
                      }))}
                      value={formData.model}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, model: value }))}
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
                    id="edit-model"
                    value={formData.model}
                    onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="gpt-3.5-turbo"
                  />
                )}
              </div>
            )}

            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isActive: checked }))}
              />
              <Label>启用</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleEditConfig}
              disabled={
                !formData.name ||
                !formData.apiKey ||
                !formData.apiBase ||
                !validationResult?.success ||
                !formData.model
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置主密码</DialogTitle>
            <DialogDescription>
              为了保护您的API密钥安全，请先设置一个主密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password-input">主密码</Label>
              <div className="relative">
                <Input
                  id="password-input"
                  type={showPassword ? "text" : "password"}
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder="输入主密码"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSetMasterPassword}>设置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}