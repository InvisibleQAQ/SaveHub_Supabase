"use client"

import { useState, useEffect } from "react"
import { X, Plus, Save } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Repository } from "@/lib/types"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { REPOSITORY_CATEGORIES } from "@/lib/repository-categories"

interface RepositoryEditModalProps {
  repository: Repository
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepositoryEditModal({
  repository,
  open,
  onOpenChange,
}: RepositoryEditModalProps) {
  const { updateRepository } = useRSSStore()
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    description: "",
    tags: [] as string[],
    category: "",
  })
  const [newTag, setNewTag] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  // Initialize form data when modal opens
  useEffect(() => {
    if (open && repository) {
      setFormData({
        description: repository.customDescription || repository.description || "",
        tags: repository.customTags?.length
          ? repository.customTags
          : repository.aiTags?.length
          ? repository.aiTags
          : repository.topics || [],
        category: repository.customCategory || "",
      })
    }
  }, [open, repository])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateRepository(repository.id, {
        customDescription: formData.description !== repository.description ? formData.description : null,
        customTags: formData.tags.length > 0 ? formData.tags : undefined,
        customCategory: formData.category || null,
      })
      toast({ title: "保存成功" })
      onOpenChange(false)
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()],
      }))
      setNewTag("")
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }))
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAddTag()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>编辑仓库信息</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Repository Info */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              {repository.ownerAvatarUrl && (
                <img
                  src={repository.ownerAvatarUrl}
                  alt={repository.ownerLogin}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <div>
                <h4 className="font-semibold">{repository.name}</h4>
                <p className="text-sm text-muted-foreground">{repository.ownerLogin}</p>
              </div>
            </div>
            {repository.description && (
              <p className="text-sm text-muted-foreground">
                原始描述: {repository.description}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>自定义描述</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="输入自定义描述..."
              rows={3}
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>分类</Label>
            <Select
              value={formData.category}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, category: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择分类..." />
              </SelectTrigger>
              <SelectContent>
                {REPOSITORY_CATEGORIES.filter((cat) => cat.id !== "all").map((category) => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.icon} {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>自定义标签</Label>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {formData.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 bg-primary/10 text-primary rounded-full text-sm"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-2 text-primary/60 hover:text-primary"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="添加标签..."
                className="flex-1"
              />
              <Button onClick={handleAddTag} disabled={!newTag.trim()} size="icon">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
