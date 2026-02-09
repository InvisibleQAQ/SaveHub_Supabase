# Agentic-RAG 实施总TODO（主执行清单）

> 建议执行方式：每完成一项就打勾，并在 PR 描述中引用对应编号。

## Phase 0：准备与依赖

- [x] T0-1 安装后端依赖（含 `langgraph`）并锁定版本
- [x] T0-2 确认当前 Chat 模型在你环境中可稳定 `tool calling`
- [x] T0-3 在 `docs/01_agentic_rag/09_待确认参数.md` 填入初始参数

**完成标准（DoD）**
- 后端可正常启动
- 依赖冲突已解决

> Phase 0 执行记录（2026-02-10）：
> - 已安装并锁定后端依赖（`backend/requirements.txt` + `backend/pyproject.toml`，含 `langgraph==1.0.6`）
> - Chat 模型确认：`gemini-3-pro`（你已确认可稳定 `tool calling`）

## Phase 1：后端 Agent 基础骨架

- [x] T1-1 新增 `agentic_rag` 模块目录（prompts/state/tools/nodes/edges/graph/service）
- [x] T1-2 新增 `AgenticRagService` 并实现主入口 `stream_chat`
- [x] T1-3 新增 LangGraph 图编排（rewrite/split/clarification/agent loop/aggregate）

**DoD**
- 本地可单元调用 `AgenticRagService.stream_chat()` 输出阶段事件

## Phase 2：工具调用与检索循环

- [x] T2-1 实现 `search_embeddings` 工具（调用 `search_all_embeddings`）
- [x] T2-2 实现 `expand_context` 工具（二次检索/邻域补全）
- [x] T2-3 实现工具调用循环上限与重试策略（防死循环）
- [x] T2-4 建立全局来源索引池（保证 `[ref:N]` 一致）

**DoD**
- 能看到工具调用事件
- 回答中引用编号可映射来源卡片

## Phase 3：新路由与SSE协议

- [x] T3-1 新增路由 `POST /api/agentic-rag/stream`
- [x] T3-2 定义并实现 SSE v2 事件（见 `05_SSE事件协议_v2.md`）
- [x] T3-3 在 `backend/app/main.py` 注册新路由

**DoD**
- 前端/脚本可消费 SSE 完整流程到 `done`

## Phase 4：前端接入与状态可视化

- [ ] T4-1 新增 `frontend/lib/api/agentic-rag.ts`
- [ ] T4-2 聊天页切换到新 API
- [ ] T4-3 UI 增加 agent 阶段状态展示（重写、调用工具、二次检索、聚合）
- [ ] T4-4 支持 `clarification_required` 的交互闭环

**DoD**
- 用户能直观看到 agent 过程状态
- `[ref:N]` + 来源卡片显示保持不变

## Phase 5：下线 Self-RAG 路径

- [ ] T5-1 移除前端对旧 `/api/rag-chat/stream` 的调用
- [ ] T5-2 标注/下线后端 `rag_chat` 路由（按发布策略选择软下线或硬下线）
- [ ] T5-3 清理无用状态文案与前端类型

**DoD**
- 业务仅走 `agentic-rag` 路由

## Phase 6：验收与上线前检查

- [ ] T6-1 按 `07_测试与验收清单.md` 完整执行
- [ ] T6-2 跑 `pnpm frontend:lint`
- [ ] T6-3 记录一次端到端演示（建议截图/录屏）

**DoD**
- 所有 P0/P1 验收项通过
