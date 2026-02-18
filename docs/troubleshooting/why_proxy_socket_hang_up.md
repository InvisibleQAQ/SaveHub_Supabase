# 为什么会出现 `Failed to proxy ... socket hang up`（白话版）

本文是给“非任务调度背景”的同学看的解释文。

目标：用最容易理解的方式说明以下问题：

1. 为什么会出现 `ECONNRESET / socket hang up`
2. 为什么会“不断重复”
3. 什么是 Beat、自调度
4. 如何从**源头**解决（不是临时抑制日志）

---

## 一句话结论

你当前系统里，**同一件事（刷新 RSS）被多个地方同时安排**，导致请求风暴；
再叠加后端存在“慢 RSS 解析 + 开发环境进程重启/未就绪窗口”，最终前端代理就会频繁看到：

- `ECONNREFUSED`（后端当时没在监听）
- `ECONNRESET` / `socket hang up`（连接中途被断开）

---

## 先解释两个关键概念

### 1) 什么是 Beat 扫描？

可以把 **Celery Beat** 理解成“每分钟响一次的总闹钟”。

- 到点后，它会执行 `scan_due_feeds`
- 这个扫描任务会找出“该刷新的 feed”
- 然后把刷新任务丢给 worker 去跑

代码位置：

- `backend/app/celery_app/celery.py:99`
- `backend/app/celery_app/tasks.py:760`

### 2) 什么是自调度？

“自调度”就是：**任务自己在结束时，给自己约下一次执行**。

例如 `refresh_feed` 跑完后，会调用 `schedule_next_refresh`，再排一个未来任务。

代码位置：

- `backend/app/celery_app/tasks.py:359`
- `backend/app/celery_app/tasks.py:448`

---

## 当前系统里，谁在“安排刷新”？

现在至少有 4 条调度链路：

1. **前端页面自动调度**（每个浏览器标签页各来一套）
   - 页面初始化时开启 scheduler
   - `frontend/app/(reader)/layout.tsx:53`
   - `frontend/lib/scheduler.ts:176`

2. **前端更新 feed 状态时，又触发后端队列调度**
   - 更新 `lastFetched` 后，调用 `/queue/schedule-feed`
   - `frontend/lib/store/feeds.slice.ts:132`
   - `frontend/lib/store/feeds.slice.ts:140`

3. **后端 Beat 每分钟扫描并调度**
   - `backend/app/celery_app/celery.py:99`
   - `backend/app/celery_app/tasks.py:760`

4. **后端 worker 执行完成后再次自调度**
   - `backend/app/celery_app/tasks.py:359`

这就是“多调度源并发”。

---

## 为什么会导致 `socket hang up`？（因果链）

### 第一步：重复安排同一 feed

同一 feed 可能在短时间被多次安排，产生密集请求：

- `/api/rss/parse`
- `/api/feeds/{id}`
- `/api/queue/schedule-feed`
- 认证相关 `/api/auth/refresh`

### 第二步：后端在某些时段吃不消或不在线

开发环境里如果出现这些情况：

- 后端还没启动好/短暂重启
- 多实例抢占端口
- 某些 RSS 源很慢

前端代理到 `127.0.0.1:8000` 时就会失败。

### 第三步：代理层报两类典型错误

1. `ECONNREFUSED`
   - 含义：连都连不上，后端端口当时没人监听

2. `ECONNRESET` + `socket hang up`
   - 含义：连接建立后，中途被对端断开（如进程重启、连接被关闭、请求超时链路中断）

---

## 这次日志里能看到什么证据

你给的日志里，三种现象都出现了：

1. **后端拒绝连接（未监听）**
   - `logs/frontend.log:3247`

2. **连接被重置（中途断开）**
   - `logs/frontend.log:4551`

3. **前端进程重复启动/端口冲突**
   - `logs/frontend.log:3216`

4. **后端 RSS 解析单次卡到约 60 秒**
   - `logs/backend.log:836`（开始）
   - `logs/backend.log:837`（1 分钟后报错）

---

## 更深一层：为什么慢 RSS 会放大问题

`/api/rss/parse` 是在 FastAPI 路由里直接调用 `feedparser.parse(url)`。

- 路由位置：`backend/app/api/routers/rss.py:47`
- 解析位置：`backend/app/services/rss_parser.py:218`

`feedparser.parse` 是同步阻塞调用。某个源很慢时，会占住服务处理能力。

当“请求本来就多”+“某些请求很慢”叠加时，代理更容易出现 `socket hang up`。

---

## 源头治理：目标架构应该是什么

核心原则：**一个业务事件，只允许一个调度主控。**

### 建议方案（推荐）

让“后端”当唯一主控，前端不再自动定时刷新。

#### 前端只做两件事

1. 用户点击“立即刷新”时，发一次手动任务（`force_immediate`）
2. 展示结果依赖 realtime 回流

即：前端不再在浏览器内跑自动 scheduler。

#### 后端两种机制二选一（不能同时要）

只保留其中一种：

- 方案 A：保留 Beat 扫描，移除 `refresh_feed -> schedule_next_refresh`
- 方案 B：保留自调度，关闭 Beat 的 feed 扫描

> 推荐 A（运维可观测性更好，节奏统一）

---

## `/api/rss/parse` 在目标架构里的定位

建议把它定位为：

- 新增 feed 时的“校验/预览接口”
- 手动调试接口

而不是周期刷新的主执行入口。

周期刷新应主要由 Celery worker 完成，避免前端绕过队列直接打解析接口。

---

## 可执行改造清单（高层）

1. 关闭前端自动 scheduler 初始化路径
2. 去掉 `updateFeed -> scheduleFeedRefresh` 这种“状态更新触发再调度”
3. 后端在 Beat 与自调度中二选一
4. 给 RSS 解析增加明确超时与隔离（线程池/异步 HTTP 客户端）
5. 开发环境统一启动入口，防止多实例并发抢端口

---

## 你可以用这个标准判断“是否修好”

改造完成后应看到：

1. 同一时间只有一种调度链路在安排刷新
2. `logs/backend.log` 中 `/api/queue/schedule-feed` 不再高频爆发
3. 前端日志中的 `ECONNREFUSED/ECONNRESET` 显著下降
4. 慢 RSS 源只影响单个任务，不再拖垮整体刷新体验

---

## 术语速记（30 秒版）

- **Beat**：固定周期触发任务的“总闹钟”
- **自调度**：任务结束后自己安排下一次
- **多调度源并发**：同一任务被多个地方同时安排
- **ECONNREFUSED**：目标端口没人监听
- **ECONNRESET / socket hang up**：连接建立后被中途断开

