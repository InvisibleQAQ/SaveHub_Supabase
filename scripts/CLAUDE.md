# Database Migration Rules

## 强制规范

### 1. 禁止修改现有文件

**任何情况下都不允许编辑、更新或删除已存在的 `.sql` 文件。**

### 2. 序号必须连续递增

- 创建新迁移前，先查找当前最大序号：`ls -1 scripts/*.sql | grep -oP '^\d+' | sort -n | tail -1`
- 新文件序号 = 最大序号 + 1
- 禁止跳号、重复序号

### 3. 文件命名规范

**格式：** `{序号}_{动作}_{目标}.sql`

**示例：**

- `010_add_feed_last_fetched_column.sql`
- `011_create_reading_stats_table.sql`
- `012_drop_unused_session_table.sql`

### 4. 必须幂等性

所有迁移必须可以安全地多次执行（使用 `IF NOT EXISTS` / `IF EXISTS`）

### 5. 需要回滚时

创建新的反向迁移文件，不要删除或修改原文件。
