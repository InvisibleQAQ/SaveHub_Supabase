"""
RAG 处理 Celery 任务。

每 30 分钟扫描未处理的文章，生成 embeddings 并存储。

设计原则：
- 核心逻辑与 Celery 解耦（便于测试）
- 用户数据隔离（通过 user_id）
- 错误容错（单篇文章失败不影响其他）
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from celery import shared_task
from celery.schedules import crontab

from .celery import app
from .supabase_client import get_supabase_service

logger = logging.getLogger(__name__)

# =============================================================================
# Constants
# =============================================================================

BATCH_SIZE = 50  # 每次扫描处理的文章数
IMAGE_CAPTION_TIMEOUT = 30  # 单张图片 caption 生成超时（秒）
MAX_IMAGES_PER_ARTICLE = 10  # 每篇文章最多处理的图片数


# =============================================================================
# Errors
# =============================================================================

class RagProcessingError(Exception):
    """RAG 处理错误基类"""
    pass


class ConfigError(RagProcessingError):
    """配置错误（用户未配置 API）"""
    pass


class ChunkingError(RagProcessingError):
    """分块错误"""
    pass


class EmbeddingError(RagProcessingError):
    """Embedding 生成错误"""
    pass


# =============================================================================
# Core Logic (decoupled from Celery)
# =============================================================================

def get_user_api_configs(user_id: str) -> Dict[str, Dict[str, str]]:
    """
    获取用户的 API 配置。

    Returns:
        {
            "chat": {"api_key": "...", "api_base": "...", "model": "..."},
            "embedding": {"api_key": "...", "api_base": "...", "model": "..."},
        }

    Raises:
        ConfigError: 配置不存在或不完整
    """
    from app.services.db.api_configs import ApiConfigService
    from app.services.encryption import decrypt

    supabase = get_supabase_service()
    service = ApiConfigService(supabase, user_id)

    configs = {}

    for config_type in ["chat", "embedding"]:
        config = service.get_active_config(config_type)
        if not config:
            raise ConfigError(f"No active {config_type} config for user {user_id}")

        # 解密 API Key
        try:
            decrypted_key = decrypt(config["api_key"])
        except Exception:
            decrypted_key = config["api_key"]  # 可能未加密

        # 解密 API Base
        try:
            decrypted_base = decrypt(config["api_base"])
        except Exception:
            decrypted_base = config["api_base"]  # 可能未加密

        configs[config_type] = {
            "api_key": decrypted_key,
            "api_base": decrypted_base,
            "model": config["model"],
        }

    return configs


def do_process_article_rag(article_id: str, user_id: str) -> Dict[str, Any]:
    """
    处理单篇文章的 RAG。

    流程：
    1. 获取文章内容
    2. 获取用户 API 配置
    3. 解析 HTML，提取文本和图片（保持原始顺序）
    4. 为图片生成 caption
    5. 将 caption 替换到图片原位置，生成完整文本
    6. 对完整文本进行语义分块
    7. 批量生成 embeddings
    8. 存入数据库
    9. 更新文章状态

    关键：图片 caption 会替代原图位置融入文本，然后一起进行语义分块，
    而不是作为独立的块分开存储。

    Args:
        article_id: 文章 ID
        user_id: 用户 ID

    Returns:
        {"success": bool, "chunks": int, "images": int, "error": Optional[str]}
    """
    from app.services.rag.chunker import (
        parse_article_content,
        chunk_text_semantic,
        fallback_chunk_text,
        ImageElement,
    )
    from app.services.rag.vision import generate_image_caption_safe
    from app.services.rag.embedder import embed_texts
    from app.services.db.rag import RagService

    supabase = get_supabase_service()
    rag_service = RagService(supabase, user_id)

    try:
        # 1. 获取文章
        result = supabase.table("articles").select(
            "id, user_id, title, author, content, rag_processed"
        ).eq("id", article_id).eq("user_id", user_id).single().execute()

        if not result.data:
            raise RagProcessingError(f"Article not found: {article_id}")

        article = result.data

        # 检查是否已处理
        if article.get("rag_processed") is True:
            logger.info(f"Article {article_id} already processed, skipping")
            return {"success": True, "chunks": 0, "images": 0, "skipped": True}

        # 2. 获取 API 配置
        try:
            configs = get_user_api_configs(user_id)
        except ConfigError as e:
            logger.warning(f"Config error for user {user_id}: {e}")
            rag_service.mark_article_rag_processed(article_id, success=False)
            return {"success": False, "error": str(e)}

        chat_config = configs["chat"]
        embedding_config = configs["embedding"]

        # 3. 解析文章内容（保持文本和图片的原始顺序）
        title = article.get("title", "")
        author = article.get("author")
        content = article.get("content", "")

        if not content:
            rag_service.mark_article_rag_processed(article_id, success=True)
            return {"success": True, "chunks": 0, "images": 0}

        parsed_article = parse_article_content(title, author, content)

        # 4. 获取所有图片 URL 并生成 caption
        image_urls = parsed_article.get_image_urls()
        image_count = 0
        captions = {}

        for url in image_urls[:MAX_IMAGES_PER_ARTICLE]:
            caption = generate_image_caption_safe(
                url,
                chat_config["api_key"],
                chat_config["api_base"],
                chat_config["model"],
            )
            if caption:
                captions[url] = caption
                image_count += 1
                logger.debug(f"Generated caption for image: {url[:50]}...")

        # 5. 将 caption 填充到原位置
        parsed_article.fill_captions(captions)

        # 6. 生成完整文本（图片 caption 已替换到原位置）
        full_text = parsed_article.to_full_text()

        if not full_text.strip():
            rag_service.mark_article_rag_processed(article_id, success=True)
            return {"success": True, "chunks": 0, "images": 0}

        logger.info(
            f"Article {article_id}: generated full text with {image_count} image captions"
        )

        # 7. 对完整文本进行语义分块
        try:
            text_chunks = chunk_text_semantic(
                full_text,
                embedding_config["api_key"],
                embedding_config["api_base"],
                embedding_config["model"],
            )
        except Exception as e:
            logger.warning(f"Semantic chunking failed, using fallback: {e}")
            text_chunks = fallback_chunk_text(full_text)

        if not text_chunks:
            rag_service.mark_article_rag_processed(article_id, success=True)
            return {"success": True, "chunks": 0, "images": image_count}

        # 8. 构建 chunk 数据
        final_chunks = []
        for i, chunk_text in enumerate(text_chunks):
            if chunk_text.strip():
                final_chunks.append({
                    "chunk_index": i,
                    "content": chunk_text.strip(),
                })

        if not final_chunks:
            rag_service.mark_article_rag_processed(article_id, success=True)
            return {"success": True, "chunks": 0, "images": image_count}

        # 9. 批量生成 embeddings
        texts = [c["content"] for c in final_chunks]
        embeddings = embed_texts(
            texts,
            embedding_config["api_key"],
            embedding_config["api_base"],
            embedding_config["model"],
        )

        for i, chunk in enumerate(final_chunks):
            chunk["embedding"] = embeddings[i]

        # 10. 保存到数据库
        saved_count = rag_service.save_embeddings(article_id, final_chunks)

        # 11. 更新文章状态
        rag_service.mark_article_rag_processed(article_id, success=True)

        logger.info(
            f"Processed article {article_id}: "
            f"chunks={saved_count}, images_captioned={image_count}"
        )

        return {
            "success": True,
            "chunks": saved_count,
            "images_captioned": image_count,
        }

    except RagProcessingError as e:
        logger.error(f"RAG processing error for {article_id}: {e}")
        rag_service.mark_article_rag_processed(article_id, success=False)
        return {"success": False, "error": str(e)}

    except Exception as e:
        logger.exception(f"Unexpected error processing {article_id}: {e}")
        try:
            rag_service.mark_article_rag_processed(article_id, success=False)
        except Exception:
            pass
        return {"success": False, "error": str(e)}


def get_pending_articles(limit: int = BATCH_SIZE) -> List[Dict[str, str]]:
    """
    获取待处理的文章列表。

    条件：images_processed = true AND rag_processed IS NULL

    Returns:
        [{"id": "...", "user_id": "..."}, ...]
    """
    supabase = get_supabase_service()

    result = supabase.table("articles") \
        .select("id, user_id") \
        .is_("rag_processed", "null") \
        .eq("images_processed", True) \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute()

    return result.data or []


# =============================================================================
# Celery Tasks
# =============================================================================

@app.task(
    bind=True,
    name="process_article_rag",
    max_retries=2,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=300,       # Hard timeout 5 minutes
    soft_time_limit=270,  # Soft timeout 4.5 minutes
)
def process_article_rag(self, article_id: str, user_id: str):
    """
    处理单篇文章的 RAG Celery 任务。

    Args:
        article_id: 文章 ID
        user_id: 用户 ID
    """
    task_id = self.request.id
    attempt = self.request.retries + 1
    max_attempts = self.max_retries + 1

    logger.info(
        f"Processing article RAG: attempt={attempt}/{max_attempts}",
        extra={
            "task_id": task_id,
            "article_id": article_id,
            "user_id": user_id,
        }
    )

    start_time = datetime.now(timezone.utc)

    try:
        result = do_process_article_rag(article_id, user_id)

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

        logger.info(
            f"RAG completed: success={result.get('success')}, "
            f"chunks={result.get('chunks', 0)}",
            extra={
                "task_id": task_id,
                "article_id": article_id,
                "duration_ms": duration_ms,
            }
        )

        return {
            "article_id": article_id,
            "duration_ms": duration_ms,
            **result,
        }

    except Exception as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.exception(
            f"RAG task failed: {e}",
            extra={
                "task_id": task_id,
                "article_id": article_id,
                "error": str(e),
                "duration_ms": duration_ms,
            }
        )
        # 不重试，让 do_process_article_rag 内部处理错误状态
        return {
            "article_id": article_id,
            "success": False,
            "error": str(e),
            "duration_ms": duration_ms,
        }


@app.task(name="scan_pending_rag_articles")
def scan_pending_rag_articles():
    """
    定时任务：扫描待处理的文章并创建 RAG 处理任务。

    每 30 分钟执行一次（由 Celery Beat 调度）。
    """
    logger.info("Scanning for pending RAG articles...")

    try:
        articles = get_pending_articles(limit=BATCH_SIZE)

        if not articles:
            logger.info("No pending articles found")
            return {"scheduled": 0}

        scheduled = 0
        for i, article in enumerate(articles):
            # 错开任务执行时间，避免同时请求 API
            process_article_rag.apply_async(
                kwargs={
                    "article_id": article["id"],
                    "user_id": article["user_id"],
                },
                countdown=i * 5,  # 每篇文章间隔 5 秒
                queue="default",
            )
            scheduled += 1

        logger.info(f"Scheduled RAG processing for {scheduled} articles")
        return {"scheduled": scheduled}

    except Exception as e:
        logger.exception(f"Failed to scan pending articles: {e}")
        return {"scheduled": 0, "error": str(e)}


# =============================================================================
# Chord Callback (triggered after all image processing completes)
# =============================================================================

@app.task(name="on_images_complete", bind=True)
def on_images_complete(self, image_results: List[dict], article_ids: List[str], feed_id: str = None):
    """
    Chord 回调：所有图片处理完成后触发。

    This is called automatically by Celery chord after all process_article_images
    tasks complete. It then schedules RAG processing for all articles.

    Args:
        image_results: List of results from each process_article_images task
        article_ids: List of article UUIDs
        feed_id: Feed ID (for logging and traceability)

    Returns:
        Summary of image processing and RAG scheduling
    """
    task_id = self.request.id
    logger.info(
        f"[CHORD_CALLBACK] on_images_complete triggered! "
        f"task_id={task_id}, feed_id={feed_id}, "
        f"image_results_count={len(image_results) if image_results else 0}, "
        f"article_ids_count={len(article_ids) if article_ids else 0}"
    )

    try:
        # Count image processing results
        success_count = sum(1 for r in image_results if r and r.get("success"))
        failed_count = len(image_results) - success_count

        logger.info(
            f"[CHORD_CALLBACK] Images complete for feed {feed_id}: "
            f"{success_count}/{len(image_results)} succeeded, "
            f"scheduling RAG for {len(article_ids)} articles"
        )

        # Schedule RAG processing
        rag_result = schedule_rag_for_articles(article_ids)

        result = {
            "feed_id": feed_id,
            "image_success": success_count,
            "image_failed": failed_count,
            "image_total": len(image_results),
            "rag_scheduled": rag_result.get("scheduled", 0),
        }
        logger.info(f"[CHORD_CALLBACK] Completed: {result}")
        return result

    except Exception as e:
        logger.exception(f"[CHORD_CALLBACK] Error in on_images_complete: {e}")
        raise


@app.task(name="schedule_rag_for_articles")
def schedule_rag_for_articles(article_ids: List[str]) -> Dict[str, Any]:
    """
    为一批文章调度 RAG 处理。

    Called by on_images_complete after all image processing finishes.
    Retrieves user_id for each article and schedules RAG tasks with staggered delays.

    Args:
        article_ids: List of article UUIDs

    Returns:
        {"scheduled": int} - number of RAG tasks scheduled
    """
    if not article_ids:
        logger.info("No articles to schedule for RAG")
        return {"scheduled": 0}

    supabase = get_supabase_service()

    # Get article user_ids
    result = supabase.table("articles").select(
        "id, user_id"
    ).in_("id", article_ids).execute()

    if not result.data:
        logger.warning(f"No articles found for RAG scheduling: {article_ids[:3]}...")
        return {"scheduled": 0}

    scheduled = 0
    for i, article in enumerate(result.data):
        process_article_rag.apply_async(
            kwargs={
                "article_id": article["id"],
                "user_id": article["user_id"],
            },
            countdown=i * 3,  # 3 second delay between each to avoid API rate limits
            queue="default",
        )
        scheduled += 1

    logger.info(f"Scheduled RAG processing for {scheduled} articles (staggered 3s apart)")
    return {"scheduled": scheduled}


# =============================================================================
# Celery Beat Schedule (to be added to celery.py)
# =============================================================================

# 在 celery.py 中添加：
# app.conf.beat_schedule = {
#     'scan-rag-every-30-minutes': {
#         'task': 'scan_pending_rag_articles',
#         'schedule': crontab(minute='*/30'),
#     },
# }
