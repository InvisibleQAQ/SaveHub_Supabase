"""Articles API router for CRUD operations."""

import logging
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query

from app.dependencies import (
    verify_auth,
    get_access_token,
    create_service_dependency,
    require_exists,
    extract_update_data,
)
from app.supabase_client import get_supabase_client
from app.schemas.articles import (
    ArticleCreate,
    ArticleUpdate,
    ArticleResponse,
    ArticleStatsResponse,
    ClearOldArticlesResponse,
)
from app.services.db.articles import ArticleService
from app.services.db.article_repositories import ArticleRepositoryService
from app.schemas.repositories import RepositoryResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/articles", tags=["articles"])


get_article_service = create_service_dependency(ArticleService)


@router.get("/stats", response_model=ArticleStatsResponse)
async def get_article_stats(service: ArticleService = Depends(get_article_service)):
    """
    Get article statistics for the authenticated user.

    Returns:
        Statistics including total, unread, starred counts and per-feed breakdown.
    """
    stats = service.get_article_stats()
    return ArticleStatsResponse(**stats)


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
    deleted_count = service.clear_old_articles(days_to_keep=days)
    logger.info(f"Cleared {deleted_count} old articles")
    return ClearOldArticlesResponse(deleted_count=deleted_count)


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
    articles = service.load_articles(
        feed_id=str(feed_id) if feed_id else None,
        limit=limit,
    )
    logger.debug(f"Retrieved {len(articles)} articles")
    return articles


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
    article_dicts = [article.model_dump() for article in articles]
    service.save_articles(article_dicts)
    logger.info(f"Created/updated {len(articles)} articles")
    return {"success": True, "count": len(articles)}


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
    article = require_exists(service.get_article(str(article_id)), "Article")
    return article


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
    require_exists(service.get_article(str(article_id)), "Article")

    update_data = extract_update_data(article_update)

    if not update_data:
        return {"success": True, "message": "No fields to update"}

    service.update_article(str(article_id), update_data)
    logger.info(f"Updated article {article_id}")
    return {"success": True}


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
