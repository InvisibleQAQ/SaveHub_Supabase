"use client"

import { useState, useEffect } from "react"
import { useRSSStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Trash2, Edit, Plus, Key, Eye, EyeOff } from "lucide-react"
import { setMasterPassword, hasMasterPassword } from "@/lib/db/api-configs"
import { useToast } from "@/hooks/use-toast"

export default function ApiConfigPage() {
  const { apiConfigs, addApiConfig, updateApiConfig, deleteApiConfig, setDefaultApiConfig } = useRSSStore()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<any>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [masterPasswordInput, setMasterPasswordInput] = useState("")
  const [passwordSet, setPasswordSet] = useState(false)
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

    addApiConfig(formData)
    resetForm()
    setIsAddDialogOpen(false)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API配置</h1>
          <p className="text-muted-foreground">管理您的AI API配置</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              添加配置
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加API配置</DialogTitle>
              <DialogDescription>添加一个新的AI API配置</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="配置名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="your-api-key"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiBase">API Base URL</Label>
                <Input
                  id="apiBase"
                  value={formData.apiBase}
                  onChange={(e) => setFormData(prev => ({ ...prev, apiBase: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">模型</Label>
                <Input
                  id="model"
                  value={formData.model}
                  onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="gpt-3.5-turbo"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
                />
                <Label>设为默认</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAddConfig}>添加</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {apiConfigs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <p className="text-muted-foreground mb-4">还没有API配置</p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                添加第一个配置
              </Button>
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
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑API配置</DialogTitle>
            <DialogDescription>修改API配置信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">名称</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="配置名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiKey">API Key</Label>
              <Input
                id="edit-apiKey"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="your-api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-apiBase">API Base URL</Label>
              <Input
                id="edit-apiBase"
                value={formData.apiBase}
                onChange={(e) => setFormData(prev => ({ ...prev, apiBase: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-model">模型</Label>
              <Input
                id="edit-model"
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                placeholder="gpt-3.5-turbo"
              />
            </div>
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
            <Button onClick={handleEditConfig}>保存</Button>
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