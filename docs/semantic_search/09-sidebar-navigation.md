# Phase 9: Sidebar 导航更新

## 概述

在 Sidebar 中添加语义搜索的导航入口。

## 修改文件

### `components/sidebar/expanded-view.tsx`

在导航列表中添加搜索链接。

#### 导入图标

```typescript
import {
  // 现有图标...
  Search,  // 添加 Search 图标
} from "lucide-react"
```

#### 添加导航项

在现有导航项（如 All、Unread、Starred）后添加 Search 链接：

```tsx
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// ... 在组件内部 ...

const pathname = usePathname()

// 在导航列表中添加
<Link
  href="/search"
  className={cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    "hover:bg-accent hover:text-accent-foreground",
    pathname === "/search"
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground"
  )}
>
  <Search className="h-4 w-4" />
  <span>语义搜索</span>
</Link>
```

#### 完整示例

假设现有的导航结构如下：

```tsx
export function ExpandedView() {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h1 className="text-lg font-semibold">SaveHub</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {/* All Articles */}
        <Link
          href="/all"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            pathname === "/all"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          <Inbox className="h-4 w-4" />
          <span>全部文章</span>
        </Link>

        {/* Unread */}
        <Link
          href="/unread"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            pathname === "/unread"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          <Circle className="h-4 w-4" />
          <span>未读</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {unreadCount}
            </Badge>
          )}
        </Link>

        {/* Starred */}
        <Link
          href="/starred"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            pathname === "/starred"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          <Star className="h-4 w-4" />
          <span>已收藏</span>
        </Link>

        {/* ===== 新增：语义搜索 ===== */}
        <Link
          href="/search"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            pathname === "/search"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          <Search className="h-4 w-4" />
          <span>语义搜索</span>
        </Link>

        {/* 分隔线 */}
        <div className="my-2 border-t border-border" />

        {/* Feeds Section */}
        {/* ... feeds 列表 ... */}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            pathname.startsWith("/settings")
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
        >
          <Settings className="h-4 w-4" />
          <span>设置</span>
        </Link>
      </div>
    </div>
  )
}
```

### `components/sidebar/collapsed-view.tsx`（可选）

如果有折叠视图，也添加对应的图标按钮：

```tsx
import { Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ... 在导航图标列表中添加 ...

<Tooltip>
  <TooltipTrigger asChild>
    <Link
      href="/search"
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        pathname === "/search"
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground"
      )}
    >
      <Search className="h-5 w-5" />
    </Link>
  </TooltipTrigger>
  <TooltipContent side="right">
    <p>语义搜索</p>
  </TooltipContent>
</Tooltip>
```

## 键盘快捷键（可选）

### `components/keyboard-shortcuts.tsx`

添加搜索页面的快捷键：

```typescript
// 在 handleKeyDown switch 中添加

// 按 Ctrl+K 或 Cmd+K 打开搜索
if ((event.ctrlKey || event.metaKey) && event.key === "k") {
  event.preventDefault()
  router.push("/search")
  return
}

// 按 / 在搜索页面聚焦输入框
case "/":
  if (pathname === "/search") {
    event.preventDefault()
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[placeholder*="搜索"]'
    )
    searchInput?.focus()
  }
  break
```

## 导航位置建议

推荐将搜索链接放在以下位置之一：

1. **核心导航后** - 在 All、Unread、Starred 之后
2. **分隔线前** - 在 Feeds 列表之前

```
├── 全部文章
├── 未读
├── 已收藏
├── 语义搜索  ← 这里
├── ──────────
├── Feeds...
```

## 验证

1. 启动开发服务器：`pnpm dev`
2. 检查 Sidebar 中是否显示"语义搜索"链接
3. 点击链接验证是否跳转到 `/search` 页面
4. 检查当前路由高亮是否正确

## 完成

至此，语义搜索功能的所有基础组件已经完成。

### 功能流程总结

```
用户配置 Embedding API（设置页面）
           ↓
新文章添加时自动生成 embedding
           ↓
用户访问 /search 页面
           ↓
输入搜索内容 → 生成查询 embedding → 向量相似度搜索
           ↓
显示搜索结果（按相似度排序）
```

### 后续优化建议

1. **搜索历史** - 记录用户的搜索历史
2. **结果缓存** - 缓存相同查询的结果
3. **高级筛选** - 按时间、Feed、已读状态筛选
4. **相关推荐** - 基于当前文章推荐相似文章
5. **混合搜索** - 结合关键词和语义搜索
