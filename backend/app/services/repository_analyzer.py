"""
Repository AI analysis service.

Shared logic for analyzing repositories with AI, used by both:
- Manual sync API (repositories.py)
- Celery background task (repository_tasks.py)
"""

import logging
from typing import Any, Awaitable, Callable, Optional

from app.services.db.api_configs import ApiConfigService
from app.services.db.repositories import RepositoryService
from app.services.ai_service import create_ai_service_from_config

logger = logging.getLogger(__name__)


async def analyze_repositories_needing_analysis(
    supabase,
    user_id: str,
    on_progress: Optional[Callable[[str, int, int], Awaitable[None]]] = None,
) -> dict[str, Any]:
    """
    AI analyze all repositories that need analysis.

    Includes:
    - Repositories with empty ai_summary
    - Repositories with empty ai_tags
    - Repositories that previously failed analysis (retry)

    Args:
        supabase: Supabase client instance
        user_id: User UUID
        on_progress: Optional async callback(repo_name, completed, total)

    Returns:
        {
            "analyzed": int,
            "failed": int,
            "skipped": bool,
            "skip_reason": str | None,
            "total_candidates": int
        }
    """
    # Get user's active chat API config
    api_config_service = ApiConfigService(supabase, user_id)
    config = api_config_service.get_active_config("chat")

    if not config:
        logger.info(f"No chat API config for user {user_id}, skipping AI analysis")
        return {"analyzed": 0, "failed": 0, "skipped": True, "skip_reason": "no_config", "total_candidates": 0}

    # Get repositories needing analysis (no limit)
    repo_service = RepositoryService(supabase, user_id)
    repos_to_analyze = repo_service.get_repositories_needing_analysis()

    if not repos_to_analyze:
        return {"analyzed": 0, "failed": 0, "skipped": False, "skip_reason": None, "total_candidates": 0}

    total_candidates = len(repos_to_analyze)
    logger.info(f"Found {total_candidates} repositories needing analysis for user {user_id}")

    # Reset analysis_failed flag for repos that will be retried
    for repo in repos_to_analyze:
        if repo.get("analysis_failed"):
            repo_service.reset_analysis_failed(repo["id"])

    # Create AI service and run batch analysis
    ai_service = create_ai_service_from_config(config)
    analysis_results = await ai_service.analyze_repositories_batch(
        repos=repos_to_analyze,
        concurrency=5,
        use_fallback=True,
        on_progress=on_progress,
    )

    # Save analysis results
    analyzed = 0
    failed = 0
    for repo_id, analysis in analysis_results.items():
        if analysis["success"]:
            is_fallback = analysis.get("fallback", False)
            repo_service.update_ai_analysis(repo_id, analysis["data"], is_fallback=is_fallback)
            if is_fallback:
                failed += 1
            else:
                analyzed += 1
        else:
            repo_service.mark_analysis_failed(repo_id)
            failed += 1

    logger.info(f"AI analysis completed: {analyzed} analyzed, {failed} failed")
    return {"analyzed": analyzed, "failed": failed, "skipped": False, "skip_reason": None, "total_candidates": total_candidates}
