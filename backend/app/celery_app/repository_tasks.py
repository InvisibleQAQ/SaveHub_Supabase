"""
GitHub repository sync Celery tasks.

Design:
1. Manual sync triggers task + schedules next auto-sync in 1 hour
2. Auto-sync completes and schedules next auto-sync in 1 hour
3. If user manually syncs before auto-sync, reset timer to 1 hour from manual sync
"""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List

import httpx
from celery import shared_task
from celery.exceptions import Reject

from .celery import app
from .task_lock import get_task_lock
from .supabase_client import get_supabase_service
from app.services.repository_analyzer import analyze_repositories_needing_analysis
from app.services.db.repositories import RepositoryService

logger = logging.getLogger(__name__)

# Sync interval: 1 hour
REPO_SYNC_INTERVAL_SECONDS = 3600


# =============================================================================
# Core business logic
# =============================================================================

def do_sync_repositories(user_id: str, github_token: str) -> Dict[str, Any]:
    """
    Core repository sync logic.

    Fetches starred repos from GitHub and upserts to database.
    Only adds/updates, never deletes (preserves unstarred repos).
    Only fetches README for new repos or repos with pushed_at change.

    Args:
        user_id: User UUID
        github_token: GitHub personal access token

    Returns:
        {"total": N, "new_count": N, "updated_count": N, "changed_github_ids": [...]}
    """
    supabase = get_supabase_service()
    repo_service = RepositoryService(supabase, user_id)

    # Run async code in sync context
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        all_repos = loop.run_until_complete(_fetch_all_starred_repos(github_token))

        # Get existing repo info to detect changes
        existing_repo_info = repo_service.get_existing_pushed_at()

        # Find repos needing README fetch:
        # 1. New repo (not in DB)
        # 2. pushed_at changed (code update)
        # 3. readme_content is empty
        github_ids_needing_readme = set()
        for repo in all_repos:
            github_id = repo.get("id") or repo.get("github_id")
            new_pushed_at = repo.get("pushed_at")

            if github_id not in existing_repo_info:
                # New repo
                github_ids_needing_readme.add(github_id)
            else:
                info = existing_repo_info[github_id]
                if info["pushed_at"] != new_pushed_at:
                    # pushed_at changed (code update)
                    github_ids_needing_readme.add(github_id)
                elif not info["has_readme"]:
                    # readme_content is empty
                    github_ids_needing_readme.add(github_id)

        # Fetch README only for repos that need it
        readme_map = {}
        if github_ids_needing_readme:
            repos_to_fetch = [
                r for r in all_repos
                if (r.get("id") or r.get("github_id")) in github_ids_needing_readme
            ]
            readme_map = loop.run_until_complete(
                _fetch_all_readmes(github_token, repos_to_fetch, concurrency=10)
            )

        # --- Fetch README for extracted repos (not in starred) ---
        starred_github_ids = {r.get("id") or r.get("github_id") for r in all_repos}
        db_repos_without_readme = repo_service.get_repos_without_readme()
        db_repos_needing_readme = [
            r for r in db_repos_without_readme
            if r["github_id"] not in starred_github_ids
        ]

        extracted_readme_map = {}
        if db_repos_needing_readme:
            repos_to_fetch_extracted = [
                {"id": r["github_id"], "full_name": r["full_name"]}
                for r in db_repos_needing_readme
            ]
            extracted_readme_map = loop.run_until_complete(
                _fetch_all_readmes(github_token, repos_to_fetch_extracted, concurrency=10)
            )
    finally:
        loop.close()

    # Merge readme_content into repo data (only for fetched repos)
    for repo in all_repos:
        github_id = repo.get("id") or repo.get("github_id")
        if github_id in github_ids_needing_readme:
            repo["readme_content"] = readme_map.get(github_id)

    # Upsert to database (will clear AI fields for changed repos)
    result = repo_service.upsert_repositories(all_repos)

    # Update readme_content for extracted repos (not in starred)
    for db_repo in db_repos_needing_readme:
        readme_content = extracted_readme_map.get(db_repo["github_id"])
        if readme_content:
            repo_service.update_readme_content(db_repo["id"], readme_content)

    logger.info(
        f"Sync completed: {result['total']} total, {result['new_count']} new, "
        f"{len(github_ids_needing_readme)} starred needed README, "
        f"{len(extracted_readme_map)}/{len(db_repos_needing_readme)} extracted repos updated"
    )

    return result


def do_ai_analysis(user_id: str) -> Dict[str, Any]:
    """
    AI analyze repositories needing analysis.
    Wrapper that runs async analyze_repositories_needing_analysis in sync context.

    Args:
        user_id: User UUID

    Returns:
        {"analyzed": N, "failed": N, "skipped": bool, "total_candidates": N}
    """
    supabase = get_supabase_service()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            analyze_repositories_needing_analysis(
                supabase=supabase,
                user_id=user_id,
                on_progress=None,
            )
        )
    finally:
        loop.close()

    return result


def do_openrank_update(user_id: str) -> Dict[str, Any]:
    """
    Fetch and update OpenRank values for all user repositories.

    Args:
        user_id: User UUID

    Returns:
        {"openrank_updated": N, "openrank_total": N}
    """
    from app.services.openrank_service import fetch_all_openranks

    supabase = get_supabase_service()
    repo_service = RepositoryService(supabase, user_id)

    all_repos = repo_service.get_all_repos_for_openrank()
    if not all_repos:
        return {"openrank_updated": 0, "openrank_total": 0}

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        openrank_map = loop.run_until_complete(
            fetch_all_openranks(all_repos, concurrency=5)
        )
    finally:
        loop.close()

    updated_count = repo_service.batch_update_openrank(openrank_map)

    logger.info(f"OpenRank update completed: {updated_count}/{len(all_repos)}")

    return {
        "openrank_updated": updated_count,
        "openrank_total": len(all_repos),
    }


def do_repository_embedding(
    user_id: str,
    on_progress: callable = None,
) -> Dict[str, Any]:
    """
    为用户的仓库生成 embeddings。

    Args:
        user_id: 用户 UUID
        on_progress: 进度回调函数 (repo_name, completed, total) -> None

    Returns:
        {"embedding_processed": N, "embedding_failed": N, "embedding_total": N}
    """
    from app.services.rag.chunker import chunk_text_semantic, fallback_chunk_text
    from app.services.rag.embedder import embed_texts
    from app.services.db.rag import RagService
    from app.celery_app.rag_processor import get_user_api_configs, ConfigError

    supabase = get_supabase_service()
    rag_service = RagService(supabase, user_id)

    # 1. 获取待处理仓库
    repos = _get_repos_needing_embedding(supabase, user_id)
    if not repos:
        return {"embedding_processed": 0, "embedding_failed": 0, "embedding_total": 0}

    # 2. 获取 API 配置
    try:
        configs = get_user_api_configs(user_id)
    except ConfigError as e:
        logger.warning(f"No embedding config for user {user_id}: {e}")
        return {
            "embedding_processed": 0,
            "embedding_failed": 0,
            "embedding_total": len(repos),
            "skipped": True,
            "reason": str(e),
        }

    embedding_config = configs["embedding"]
    processed = 0
    failed = 0
    total = len(repos)

    # 3. 处理每个仓库
    for i, repo in enumerate(repos):
        # 报告进度
        if on_progress:
            try:
                on_progress(repo.get("full_name", ""), i, total)
            except Exception as e:
                logger.debug(f"Progress callback failed: {e}")

        try:
            result = _process_single_repository_embedding(
                repo, embedding_config, rag_service
            )
            if result["success"]:
                processed += 1
            else:
                failed += 1
        except Exception as e:
            logger.error(f"Failed to process embedding for repo {repo['id']}: {e}")
            rag_service.mark_repository_embedding_processed(repo["id"], success=False)
            failed += 1

    logger.info(f"Repository embedding completed: {processed}/{total}, {failed} failed")

    return {
        "embedding_processed": processed,
        "embedding_failed": failed,
        "embedding_total": total,
    }


def _get_repos_needing_embedding(supabase, user_id: str) -> List[dict]:
    """获取需要生成 embedding 的仓库列表。"""
    result = supabase.table("repositories") \
        .select("id, full_name, description, html_url, owner_login, topics, "
                "ai_tags, language, readme_content, ai_summary") \
        .eq("user_id", user_id) \
        .is_("embedding_processed", "null") \
        .not_.is_("readme_content", "null") \
        .limit(50) \
        .execute()
    return result.data or []


def _build_repository_text(repo: dict) -> str:
    """组合仓库文本用于 embedding。"""
    parts = []
    parts.append(f"仓库名称: {repo.get('full_name', '')}")

    if repo.get("description"):
        parts.append(f"描述: {repo['description']}")
    if repo.get("html_url"):
        parts.append(f"链接: {repo['html_url']}")
    if repo.get("owner_login"):
        parts.append(f"所有者: {repo['owner_login']}")

    topics = repo.get("topics") or []
    if topics:
        parts.append(f"标签: {', '.join(topics)}")

    ai_tags = repo.get("ai_tags") or []
    if ai_tags:
        parts.append(f"AI标签: {', '.join(ai_tags)}")

    if repo.get("language"):
        parts.append(f"主要语言: {repo['language']}")

    if repo.get("readme_content"):
        parts.append(f"\nREADME内容:\n{repo['readme_content']}")

    if repo.get("ai_summary"):
        parts.append(f"\nAI摘要:\n{repo['ai_summary']}")

    return "\n".join(parts)


def _process_single_repository_embedding(
    repo: dict,
    embedding_config: dict,
    rag_service,
) -> Dict[str, Any]:
    """处理单个仓库的 embedding 生成。"""
    from app.services.rag.chunker import chunk_text_semantic, fallback_chunk_text
    from app.services.rag.embedder import embed_texts

    repository_id = repo["id"]

    try:
        # 1. 组合文本
        full_text = _build_repository_text(repo)
        if not full_text.strip():
            rag_service.mark_repository_embedding_processed(repository_id, success=True)
            return {"success": True, "chunks": 0}

        # 2. 语义分块
        try:
            text_chunks = chunk_text_semantic(
                full_text,
                embedding_config["api_key"],
                embedding_config["api_base"],
                embedding_config["model"],
            )
        except Exception as e:
            logger.warning(f"Semantic chunking failed for repo {repository_id}: {e}")
            text_chunks = fallback_chunk_text(full_text)

        if not text_chunks:
            rag_service.mark_repository_embedding_processed(repository_id, success=True)
            return {"success": True, "chunks": 0}

        # 3. 构建 chunk 数据
        final_chunks = [
            {"chunk_index": i, "content": chunk.strip()}
            for i, chunk in enumerate(text_chunks) if chunk.strip()
        ]

        if not final_chunks:
            rag_service.mark_repository_embedding_processed(repository_id, success=True)
            return {"success": True, "chunks": 0}

        # 4. 批量生成 embeddings
        texts = [c["content"] for c in final_chunks]
        embeddings = embed_texts(
            texts,
            embedding_config["api_key"],
            embedding_config["api_base"],
            embedding_config["model"],
        )

        for i, chunk in enumerate(final_chunks):
            chunk["embedding"] = embeddings[i]

        # 5. 保存到数据库
        saved_count = rag_service.save_repository_embeddings(repository_id, final_chunks)

        # 6. 更新状态
        rag_service.mark_repository_embedding_processed(repository_id, success=True)

        logger.info(f"Processed repository {repo['full_name']}: chunks={saved_count}")
        return {"success": True, "chunks": saved_count}

    except Exception as e:
        logger.error(f"Repository embedding failed for {repository_id}: {e}")
        rag_service.mark_repository_embedding_processed(repository_id, success=False)
        return {"success": False, "error": str(e)}


async def _fetch_all_starred_repos(token: str) -> List[dict]:
    """Fetch all starred repositories from GitHub API with pagination."""
    all_repos = []
    page = 1
    per_page = 100

    async with httpx.AsyncClient() as client:
        while True:
            response = await client.get(
                "https://api.github.com/user/starred",
                params={"page": page, "per_page": per_page, "sort": "updated"},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github.star+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                timeout=30.0
            )

            if response.status_code == 401:
                raise ValueError("Invalid GitHub token")
            if response.status_code == 403:
                raise ValueError("GitHub API rate limit exceeded")
            if response.status_code != 200:
                raise ValueError(f"GitHub API error: {response.status_code}")

            repos = response.json()
            if not repos:
                break

            for item in repos:
                repo = item.get("repo", item)
                repo["starred_at"] = item.get("starred_at")
                all_repos.append(repo)

            if len(repos) < per_page:
                break

            page += 1
            await asyncio.sleep(0.1)

    logger.info(f"Fetched {len(all_repos)} starred repositories from GitHub")
    return all_repos


async def _fetch_readme(
    client: httpx.AsyncClient,
    token: str,
    full_name: str
) -> str | None:
    """Fetch README content for a single repository."""
    try:
        response = await client.get(
            f"https://api.github.com/repos/{full_name}/readme",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.raw+json",
                "X-GitHub-Api-Version": "2022-11-28"
            },
            timeout=10.0
        )
        if response.status_code == 200:
            return response.text
        return None
    except Exception as e:
        logger.debug(f"Failed to fetch README for {full_name}: {e}")
        return None


async def _fetch_all_readmes(
    token: str,
    repos: List[dict],
    concurrency: int = 10
) -> dict[int, str]:
    """Fetch README content for all repositories with concurrency control."""
    semaphore = asyncio.Semaphore(concurrency)
    results: dict[int, str] = {}

    async def fetch_one(client: httpx.AsyncClient, repo: dict):
        async with semaphore:
            github_id = repo.get("id") or repo.get("github_id")
            full_name = repo.get("full_name")
            content = await _fetch_readme(client, token, full_name)
            if content:
                results[github_id] = content
            await asyncio.sleep(0.05)

    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(f"Fetched README for {len(results)}/{len(repos)} repositories")
    return results


# =============================================================================
# Celery tasks
# =============================================================================

@app.task(
    bind=True,
    name="sync_repositories",
    max_retries=2,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    acks_late=True,
    time_limit=600,      # Hard timeout 10 minutes (README fetching is slow)
    soft_time_limit=540,  # Soft timeout 9 minutes
)
def sync_repositories(
    self,
    user_id: str,
    trigger: str = "auto",  # "manual" or "auto"
):
    """
    Sync GitHub starred repositories for a user.

    Args:
        user_id: User UUID
        trigger: "manual" (user clicked sync) or "auto" (scheduled)
    """
    task_id = self.request.id
    task_lock = get_task_lock()
    lock_key = f"repo_sync:{user_id}"
    lock_ttl = 660  # 11 minutes (longer than task timeout)

    logger.info(
        f"[REPO_SYNC] Starting sync for user {user_id}, trigger={trigger}",
        extra={'task_id': task_id, 'user_id': user_id, 'trigger': trigger}
    )

    # Acquire lock to prevent duplicate execution
    if not task_lock.acquire(lock_key, lock_ttl, task_id):
        remaining = task_lock.get_ttl(lock_key)
        logger.info(f"[REPO_SYNC] User {user_id} sync already running, lock expires in {remaining}s")
        raise Reject(f"Repo sync for user {user_id} is locked", requeue=False)

    start_time = datetime.now(timezone.utc)

    try:
        # Get GitHub token from settings
        supabase = get_supabase_service()
        settings_result = supabase.table("settings") \
            .select("github_token") \
            .eq("user_id", user_id) \
            .single() \
            .execute()

        if not settings_result.data or not settings_result.data.get("github_token"):
            logger.warning(f"[REPO_SYNC] No GitHub token for user {user_id}")
            return {
                "success": False,
                "user_id": user_id,
                "error": "GitHub token not configured"
            }

        github_token = settings_result.data["github_token"]

        # Execute sync
        result = do_sync_repositories(user_id, github_token)

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            f"[REPO_SYNC] Completed for user {user_id}: "
            f"{result['total']} total, {result['new_count']} new, {duration_ms}ms",
            extra={
                'task_id': task_id,
                'user_id': user_id,
                'trigger': trigger,
                'total': result['total'],
                'new_count': result['new_count'],
                'duration_ms': duration_ms,
            }
        )

        # AI analyze repositories needing analysis (no condition check)
        ai_result = {"ai_analyzed": 0, "ai_failed": 0, "ai_candidates": 0}
        try:
            ai_analysis = do_ai_analysis(user_id)
            ai_result["ai_analyzed"] = ai_analysis["analyzed"]
            ai_result["ai_failed"] = ai_analysis["failed"]
            ai_result["ai_candidates"] = ai_analysis.get("total_candidates", 0)
        except Exception as e:
            logger.warning(f"AI analysis during sync failed: {e}")

        # Fetch OpenRank for all repositories
        openrank_result = {"openrank_updated": 0, "openrank_total": 0}
        try:
            openrank_result = do_openrank_update(user_id)
        except Exception as e:
            logger.warning(f"OpenRank update during sync failed: {e}")

        # Generate embeddings for repositories
        embedding_result = {"embedding_processed": 0, "embedding_failed": 0, "embedding_total": 0}
        try:
            embedding_result = do_repository_embedding(user_id)
        except Exception as e:
            logger.warning(f"Repository embedding during sync failed: {e}")

        # Schedule next auto-sync in 1 hour
        schedule_next_repo_sync(user_id)

        return {
            "success": True,
            "user_id": user_id,
            "total": result["total"],
            "new_count": result["new_count"],
            "updated_count": result["updated_count"],
            "duration_ms": duration_ms,
            **ai_result,
            **openrank_result,
            **embedding_result,
        }

    except ValueError as e:
        # Non-retryable errors (invalid token, rate limit)
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error(
            f"[REPO_SYNC] Failed for user {user_id}: {e}",
            extra={'task_id': task_id, 'user_id': user_id, 'error': str(e)}
        )
        return {
            "success": False,
            "user_id": user_id,
            "error": str(e),
            "duration_ms": duration_ms
        }

    except Exception as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.exception(
            f"[REPO_SYNC] Unexpected error for user {user_id}: {e}",
            extra={'task_id': task_id, 'user_id': user_id, 'error': str(e)}
        )
        # Retry on unexpected errors
        raise self.retry(exc=e)

    finally:
        task_lock.release(lock_key, task_id)


# =============================================================================
# Scheduling functions
# =============================================================================

def schedule_next_repo_sync(user_id: str):
    """
    Schedule next repository sync in 1 hour.

    If there's already a scheduled sync, cancel it first (reset timer).
    This ensures manual sync resets the auto-sync timer.
    """
    task_lock = get_task_lock()
    redis = task_lock.redis

    # Cancel any existing scheduled sync first
    cancel_repo_sync(user_id)

    # Schedule new sync
    task = sync_repositories.apply_async(
        kwargs={
            "user_id": user_id,
            "trigger": "auto"
        },
        countdown=REPO_SYNC_INTERVAL_SECONDS,
        queue="default"
    )

    # Store task ID in Redis for later cancellation
    task_id_key = f"repo_sync_task:{user_id}"
    task_ttl = REPO_SYNC_INTERVAL_SECONDS + 300  # TTL = 1 hour + 5 min buffer
    redis.setex(task_id_key, task_ttl, task.id)

    logger.info(
        f"[REPO_SYNC] Scheduled next sync for user {user_id} "
        f"in {REPO_SYNC_INTERVAL_SECONDS}s (task_id={task.id})"
    )


def cancel_repo_sync(user_id: str) -> bool:
    """
    Cancel scheduled repository sync for a user.

    Called before scheduling new sync to reset timer,
    or when user removes GitHub token.
    """
    task_lock = get_task_lock()
    redis = task_lock.redis

    task_id_key = f"repo_sync_task:{user_id}"
    task_id = redis.get(task_id_key)

    revoked = False
    if task_id:
        if isinstance(task_id, bytes):
            task_id = task_id.decode('utf-8')

        app.control.revoke(task_id, terminate=False)
        logger.info(f"[REPO_SYNC] Revoked scheduled task {task_id} for user {user_id}")
        revoked = True

    # Clean up Redis key
    redis.delete(task_id_key)

    return revoked
