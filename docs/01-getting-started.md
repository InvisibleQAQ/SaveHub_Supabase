# 快速开始指南

## 前提条件

- Node.js 18+
- pnpm 包管理器
- Supabase 账号（免费）
- 基础的 React/Next.js 知识

## 第一次启动（10 分钟搞定）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置 Supabase

你的 `.env` 已经配置好了，但还需要初始化数据库。

**步骤**：
1. 打开 https://supabase.com/dashboard
2. 找到你的项目 `xxhlzzntzrdktyzkjpxu`
3. 点击左侧 **SQL Editor**
4. 复制 `scripts/001_create_tables.sql` 的全部内容
5. 粘贴到 SQL Editor，点击 **Run**

**这个 SQL 文件做了什么？**
- 创建 4 张表：folders（文件夹）、feeds（订阅源）、articles（文章）、settings（设置）
- 创建索引加速查询
- 插入默认设置

### 3. 启动开发服务器

```bash
pnpm dev
```

打开 http://localhost:3000，你应该看到 RSS Reader 界面。

### 4. 第一次使用

1. 点击侧边栏的 **+ Add Feed** 按钮
2. 输入一个 RSS 源，比如：`https://hnrss.org/frontpage`
3. 点击 Add，等待抓取文章
4. 点击文章查看内容

**恭喜，你已经跑起来了！**

## 开发环境验证

如何确认一切正常？

```bash
# 构建应该没有类型错误
pnpm build

# Lint 应该通过
pnpm lint
```

如果这两个命令都成功，环境就 OK 了。

## 常见首次启动问题

### 问题 1：页面显示 "Database not initialized"

**原因**：你没有运行 SQL 初始化脚本。

**解决**：回到步骤 2，在 Supabase SQL Editor 运行 `scripts/001_create_tables.sql`。

### 问题 2：环境变量错误

**症状**：控制台报错 `Invalid Supabase URL` 或 `Invalid API key`。

**解决**：
1. 检查 `.env` 文件是否存在且有内容
2. 确认 URL 格式是 `https://xxx.supabase.co`
3. 确认 anon key 是完整的 JWT token（很长的字符串）
4. **重启开发服务器**（Next.js 不会热重载 env 文件）

### 问题 3：RSS 源添加失败

**原因**：可能是跨域问题或 RSS 源不可用。

**调试方法**：
1. 打开浏览器控制台查看错误
2. 尝试换一个 RSS 源测试
3. 检查 `app/api/rss/parse/route.ts` 的服务器日志

## 下一步

- 阅读 [项目架构](./02-architecture.md) 了解系统设计
- 阅读 [文件结构](./03-file-structure.md) 了解每个文件的作用
- 阅读 [开发指南](./05-development-guide.md) 开始写代码