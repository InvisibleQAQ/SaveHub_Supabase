# Transcripts Service Module

视频转录处理管线：字幕提取 / Whisper 语音转录 / AI 文本优化 / 翻译 / 摘要。

## 目录结构

```
transcripts/
├── __init__.py        # 模块导出
├── pipeline.py        # TranscriptPipelineService - 编排器（入口）
├── task_manager.py    # TranscriptTaskManager - 内存任务生命周期 + SSE 订阅
├── media.py           # MediaService - yt-dlp 音频下载 + ffmpeg 归一化
├── subtitle.py        # SubtitleService - 字幕探测/下载/解析(VTT/SRT→Markdown)
├── whisper.py         # WhisperTranscriber - faster-whisper 本地转录
└── ai_text.py         # TranscriptAiTextService - ChatClient 适配（优化/翻译/摘要）
```

## 数据流

```
POST /api/transcripts/process
  → pipeline.enqueue() → asyncio.create_task(_run_task)
  → _resolve_source_text():
      1. subtitle_probe → subtitle_download → parse_to_markdown  (字幕优先)
      2. fallback: audio_download → whisper.transcribe_audio      (Whisper 回退)
  → ai_text: optimize → translate → summarize  (各阶段 soft-fail)
  → publish result/done SSE events
```

## 关键设计

- **无持久化**：任务状态全部在内存（`task_manager._records`），TTL 过期自动清理
- **并发控制**：`asyncio.Semaphore(max_concurrent_tasks)` 限制同时处理数
- **阻塞操作**：yt-dlp / ffmpeg / whisper 通过 `ThreadPoolExecutor` + `run_in_executor` 异步化
- **SSE 扇出**：每个 SSE 客户端持有独立 `asyncio.Queue`，`publish_event` 广播到所有订阅者
- **Soft-fail**：optimize / translate / summarize 阶段失败不中断管线，降级返回原始文本
- **SSRF 防护**：`schemas/transcripts.py` 的 `_validate_video_url()` 拦截内网/环回/保留地址
- **CancelledError**：所有 soft-fail `except Exception` 前显式 `except asyncio.CancelledError: raise`

## AI 配置

通过 `TranscriptAiTextService.from_user_config(supabase, user_id)` 工厂方法获取，内部调用 `get_user_ai_configs()` 读取解密后的用户 Chat API 配置，遵循 `services/CLAUDE.md` 的 AI 配置读取规范。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TRANSCRIPTS_TEMP_DIR` | `/tmp/savehub-transcripts` | 临时文件目录 |
| `TRANSCRIPTS_MAX_CONCURRENT_TASKS` | `2` | 最大并发任务数 |
| `TRANSCRIPTS_EXECUTOR_MAX_WORKERS` | `4` | 线程池大小 |
| `TRANSCRIPTS_TASK_TTL_SECONDS` | `3600` | 任务过期时间 |
| `WHISPER_MODEL_SIZE` | `base` | faster-whisper 模型 |
| `WHISPER_COMPUTE_TYPE` | `int8` | 推理精度 |
