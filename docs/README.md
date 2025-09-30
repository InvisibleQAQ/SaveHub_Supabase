# 开发者文档

欢迎！这些文档会帮你快速上手这个 RSS Reader 项目。

## 📚 文档导航

### 1. [快速开始](./01-getting-started.md)
- 10 分钟跑起来
- 环境配置
- 数据库初始化
- 常见启动问题

**适合**：刚拿到项目，想先跑起来看看

---

### 2. [项目架构](./02-architecture.md)
- 核心设计哲学
- 三层架构（UI → Store → Database）
- 数据同步机制
- 关键设计决策

**适合**：想理解项目整体设计思路

---

### 3. [文件结构](./03-file-structure.md)
- 目录树
- 每个文件的作用
- 文件关系图
- 何时修改哪些文件

**适合**：想知道某个功能在哪个文件里

---

### 4. [数据流详解](./04-data-flow.md)
- 7 大核心场景的数据流
- 添加 Feed、标记已读、实时同步等
- 数据流动原则
- 常见数据流问题

**适合**：想深入理解数据如何在系统中流动

---

### 5. [开发指南](./05-development-guide.md)
- 开发环境设置
- 5 大核心开发模式
- 调试技巧
- 常见开发陷阱

**适合**：准备开始写代码

---

### 6. [常见任务](./06-common-tasks.md)
- 6 个完整代码示例
- 添加设置、标签、快捷键、搜索等
- 导出导入 OPML
- 阅读统计

**适合**：想参考具体实现

---

### 7. [故障排查](./07-troubleshooting.md)
- 11 个常见问题及解决方案
- 数据库、RSS、UI、类型、构建问题
- 调试工具和技巧
- 常用调试代码片段

**适合**：遇到问题时查阅

---

## 🚀 推荐学习路径

### 新手路径（第一天）

1. ✅ 阅读[快速开始](./01-getting-started.md)，把项目跑起来
2. ✅ 浏览[项目架构](./02-architecture.md)，理解大局
3. ✅ 翻阅[文件结构](./03-file-structure.md)，了解文件位置
4. ⏸️  遇到问题时查[故障排查](./07-troubleshooting.md)

### 进阶路径（第二天）

5. ✅ 深入[数据流详解](./04-data-flow.md)，理解数据流动
6. ✅ 阅读[开发指南](./05-development-guide.md)，学习开发模式
7. ✅ 参考[常见任务](./06-common-tasks.md)，尝试写代码

### 实战路径（第三天起）

8. 🔥 挑选一个功能需求
9. 🔥 参考[常见任务](./06-common-tasks.md)找相似示例
10. 🔥 动手实现，遇到问题查[故障排查](./07-troubleshooting.md)
11. 🔥 提交代码，迭代改进

---

## 🎯 快速查找

### 我想...

- **运行项目** → [快速开始](./01-getting-started.md#第一次启动10-分钟搞定)
- **理解整体设计** → [项目架构](./02-architecture.md#三层架构)
- **找某个文件** → [文件结构](./03-file-structure.md#核心文件详解)
- **理解数据如何更新** → [数据流详解](./04-data-flow.md#场景-1添加订阅源)
- **添加新功能** → [开发指南](./05-development-guide.md#核心开发模式)
- **参考代码示例** → [常见任务](./06-common-tasks.md)
- **解决报错** → [故障排查](./07-troubleshooting.md)

### 遇到问题...

- **数据库问题** → [故障排查 - 数据库](./07-troubleshooting.md#数据库相关问题)
- **RSS 抓取问题** → [故障排查 - RSS](./07-troubleshooting.md#rss-抓取问题)
- **UI 不更新** → [故障排查 - UI](./07-troubleshooting.md#ui-渲染问题)
- **TypeScript 错误** → [故障排查 - TypeScript](./07-troubleshooting.md#typescript-类型问题)
- **构建失败** → [故障排查 - 构建](./07-troubleshooting.md#构建和部署问题)

---

## 📖 文档使用技巧

1. **善用搜索**：在 VSCode 中按 Ctrl+Shift+F 全文搜索关键词
2. **对照代码阅读**：打开对应文件，边看文档边看代码
3. **实践为主**：看懂架构后，直接动手改代码最有效
4. **遇到问题先搜索**：大概率已经在故障排查文档中

---

## 🛠️ 技术栈速查

| 技术 | 用途 | 文档 |
|------|------|------|
| Next.js 14 | 框架 | [nextjs.org](https://nextjs.org) |
| React 18 | UI 库 | [react.dev](https://react.dev) |
| TypeScript | 类型系统 | [typescriptlang.org](https://www.typescriptlang.org) |
| Zustand | 状态管理 | [docs.pmnd.rs/zustand](https://docs.pmnd.rs/zustand) |
| Supabase | 数据库 + Realtime | [supabase.com/docs](https://supabase.com/docs) |
| Tailwind CSS | 样式 | [tailwindcss.com](https://tailwindcss.com) |
| shadcn/ui | 组件库 | [ui.shadcn.com](https://ui.shadcn.com) |
| Zod | 类型验证 | [zod.dev](https://zod.dev) |
| rss-parser | RSS 解析 | [npmjs.com/package/rss-parser](https://www.npmjs.com/package/rss-parser) |

---

## 💡 贡献文档

发现文档有误或需要补充？欢迎直接修改：

1. 编辑对应的 `.md` 文件
2. 遵循现有格式和风格
3. 提交 PR 或直接提交

---

**祝你开发愉快！**