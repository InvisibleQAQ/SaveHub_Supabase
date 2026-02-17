"""Articles API router for CRUD operations."""

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from app.dependencies import verify_auth, get_access_token
from app.supabase_client import get_supabase_client
from app.schemas.articles import (
    ArticleCreate,
    ArticleUpdate,
    ArticleResponse,
    ArticleStatsResponse,
    ClearOldArticlesResponse,
    FetchFullContentRequest,
    FetchFullContentResponse,
)
from app.services.db.articles import ArticleService
from app.services.db.feeds import FeedService
from app.services.db.settings import SettingsService
from app.services.db.article_repositories import ArticleRepositoryService
from app.services.full_text_fetch import (
    fetch_full_content_html,
    FullTextFetchError,
    has_meaningful_extracted_text,
)
from app.schemas.repositories import RepositoryResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/articles", tags=["articles"])


def get_article_service(
    access_token: str = Depends(get_access_token),
    user=Depends(verify_auth)
) -> ArticleService:
    """Create ArticleService instance with authenticated user's session."""
    client = get_supabase_client(access_token)
    return ArticleService(client, user.user.id)


@router.get("/stats", response_model=ArticleStatsResponse)
async def get_article_stats(service: ArticleService = Depends(get_article_service)):
    """
    Get article statistics for the authenticated user.

    Returns:
        Statistics including total, unread, starred counts and per-feed breakdown.
    """
    try:
        stats = service.get_article_stats()
        return ArticleStatsResponse(**stats)
    except Exception as e:
        logger.error(f"Failed to get article stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve article statistics")


@router.delete("/old", response_model=ClearOldArticlesResponse)
async def clear_old_articles(
    days: int = Query(default=30, ge=1, le=365, description="Days to keep articles"),
    service: ArticleService = Depends(get_article_service),
):
    """
    Clear old read articles that are not starred.

    Args:
        days: Number of days to keep articles (default 30, range 1-365)

    Returns:
        Number of articles deleted.
    """
    try:
        deleted_count = service.clear_old_articles(days_to_keep=days)
        logger.info(f"Cleared {deleted_count} old articles")
        return ClearOldArticlesResponse(deleted_count=deleted_count)
    except Exception as e:
        logger.error(f"Failed to clear old articles: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear old articles")


@router.get("", response_model=List[ArticleResponse])
async def get_articles(
    feed_id: Optional[UUID] = Query(default=None, description="Filter by feed ID"),
    limit: Optional[int] = Query(default=None, ge=1, le=1000, description="Max articles to return"),
    service: ArticleService = Depends(get_article_service),
):
    """
    Get articles for the authenticated user.

    Args:
        feed_id: Optional feed UUID to filter by
        limit: Optional max number of articles (range 1-1000)

    Returns:
        List of articles ordered by published_at descending.
    """
    try:
        articles = service.load_articles(
            feed_id=str(feed_id) if feed_id else None,
            limit=limit,
        )
        logger.debug(f"Retrieved {len(articles)} articles")
        return articles
    except Exception as e:
        logger.error(f"Failed to get articles: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve articles")


@router.post("", response_model=dict)
async def create_articles(
    articles: List[ArticleCreate],
    service: ArticleService = Depends(get_article_service),
):
    """
    Create or upsert multiple articles.

    Supports bulk creation/update of articles.

    Args:
        articles: List of articles to create/update

    Returns:
        Success status with count of created articles.
    """
    try:
        article_dicts = [article.model_dump() for article in articles]
        service.save_articles(article_dicts)
        logger.info(f"Created/updated {len(articles)} articles")
        return {"success": True, "count": len(articles)}
    except Exception as e:
        logger.error(f"Failed to create articles: {e}")
        raise HTTPException(status_code=500, detail="Failed to create articles")


@router.get("/{article_id}", response_model=ArticleResponse)
async def get_article(
    article_id: UUID,
    service: ArticleService = Depends(get_article_service),
):
    """
    Get a single article by ID.

    Args:
        article_id: UUID of the article

    Returns:
        Article details if found.

    Raises:
        404 if article not found.
    """
    try:
        article = service.get_article(str(article_id))
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        return article
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get article {article_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve article")


@router.patch("/{article_id}", response_model=dict)
async def update_article(
    article_id: UUID,
    article_update: ArticleUpdate,
    service: ArticleService = Depends(get_article_service),
):
    """
    Update an article by ID.

    Supports partial updates - only provided fields will be updated.
    Primary use case: updating is_read and is_starred status.

    Args:
        article_id: UUID of the article to update
        article_update: Fields to update

    Returns:
        Success status.

    Raises:
        404 if article not found.
    """
    try:
        existing = service.get_article(str(article_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Article not found")

        update_data = {k: v for k, v in article_update.model_dump().items() if v is not None}

        if not update_data:
            return {"success": True, "message": "No fields to update"}

        service.update_article(str(article_id), update_data)
        logger.info(f"Updated article {article_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update article {article_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update article")


@router.get("/{article_id}/repositories", response_model=List[RepositoryResponse])
async def get_article_repositories(
    article_id: UUID,
    access_token: str = Depends(get_access_token),
    user=Depends(verify_auth),
):
    """
    Get repositories linked to an article.

    Returns repositories extracted from the article content.

    Args:
        article_id: UUID of the article

    Returns:
        List of repositories linked to this article.
    """
    try:
        client = get_supabase_client(access_token)
        service = ArticleRepositoryService(client, user.user.id)

        # Get junction records with nested repository data
        junction_records = service.get_repos_for_article(str(article_id))

        # Extract repository data from nested 'repositories' field
        repositories = []
        list_fields = ['topics', 'ai_tags', 'ai_platforms', 'custom_tags']
        for record in junction_records:
            repo_data = record.get("repositories")
            if repo_data:
                # Convert None to empty list for list fields
                for field in list_fields:
                    if repo_data.get(field) is None:
                        repo_data[field] = []
                repositories.append(repo_data)

        logger.debug(f"Retrieved {len(repositories)} repositories for article {article_id}")
        return repositories
    except Exception as e:
        logger.error(f"Failed to get repositories for article {article_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve article repositories")


@router.post("/{article_id}/fetch-full", response_model=FetchFullContentResponse)
async def fetch_full_content(
    article_id: UUID,
    payload: FetchFullContentRequest = Body(default_factory=FetchFullContentRequest),
    access_token: str = Depends(get_access_token),
    user=Depends(verify_auth),
):
    """
    Fetch full content from article's original URL using readability extraction.

    Uses readability-lxml to extract readable content from the source page.
    Results are persisted to the articles table for future access.

    Args:
        article_id: UUID of the article
        payload: Optional force_refresh flag

    Returns:
        Extracted full content with metadata.

    Raises:
        403: Full text fetch disabled in settings
        404: Article or feed not found
        422: Article has no URL or extraction failed
        502: Upstream connection error
        504: Fetch timeout
    """
    try:
        client = get_supabase_client(access_token)
        article_service = ArticleService(client, user.user.id)
        feed_service = FeedService(client, user.user.id)
        settings_service = SettingsService(client, user.user.id)

        # 1. Get article
        article = article_service.get_article(str(article_id))
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")

        # 2. Check global setting
        settings = settings_service.load_settings() or {}
        if not settings.get("full_text_fetch_enabled", True):
            raise HTTPException(status_code=403, detail="Full text fetch is disabled")

        # 3. Check article has URL
        source_url = article.get("url", "").strip()
        if not source_url:
            raise HTTPException(status_code=422, detail="Article has no source URL")

        # 4. Get feed for auto_expand config
        feed = feed_service.get_feed(article["feed_id"])
        feed_config = feed.get("auto_expand_content", "global") if feed else "global"

        # 5. Compute effective auto_show_all_content
        if feed_config == "enabled":
            effective_auto_show = True
        elif feed_config == "disabled":
            effective_auto_show = False
        else:
            effective_auto_show = settings.get("auto_show_all_content", False)

        # 6. Return cached if available and not force refresh
        cached_full_content = article.get("full_content")
        if cached_full_content and not payload.force_refresh:
            if not has_meaningful_extracted_text(cached_full_content):
                logger.info(
                    f"Cached full content for article {article_id} has no readable text, refetching"
                )
            else:
                return FetchFullContentResponse(
                    success=True,
                    article_id=article_id,
                    source_url=source_url,
                    fetch_status="cached",
                    cached=True,
                    full_content=cached_full_content,
                    full_content_fetched_at=article["full_content_fetched_at"],
                    auto_show_all_content=effective_auto_show,
                )

        # 7. Fetch and extract
        full_html = await fetch_full_content_html(source_url, timeout_seconds=30.0)
        fetched_at = datetime.now(timezone.utc)

        # 8. Persist
        article_service.update_full_content(str(article_id), full_html, fetched_at)

        logger.info(f"Fetched full content for article {article_id} ({len(full_html)} chars)")
        return FetchFullContentResponse(
            success=True,
            article_id=article_id,
            source_url=source_url,
            fetch_status="fetched",
            cached=False,
            full_content=full_html,
            full_content_fetched_at=fetched_at,
            auto_show_all_content=effective_auto_show,
        )

    except HTTPException:
        raise
    except FullTextFetchError as e:
        logger.warning(f"Full text fetch failed for article {article_id}: {e.detail}")
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception as e:
        logger.error(f"Unexpected error fetching full content for article {article_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch full content")
