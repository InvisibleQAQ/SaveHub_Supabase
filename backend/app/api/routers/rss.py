"""RSS API router for feed validation and parsing."""

import logging
from fastapi import APIRouter, Depends, HTTPException
import feedparser

from app.dependencies import verify_jwt
from app.schemas.rss import (
    ValidateRequest,
    ValidateResponse,
    ParseRequest,
    ParseResponse,
)
from app.services.rss_parser import parse_rss_feed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rss", tags=["rss"])


@router.post("/validate", response_model=ValidateResponse)
async def validate_rss(request: ValidateRequest, user=Depends(verify_jwt)):
    """
    Validate if a URL points to a valid RSS/Atom feed.

    Returns:
        ValidateResponse with valid=True if feed is parseable
    """
    try:
        parsed = feedparser.parse(str(request.url))
        # A feed is valid if it has entries or at least a title
        valid = bool(parsed.entries) or bool(parsed.feed.get("title"))
        logger.info(f"RSS validation: url={request.url}, valid={valid}, user={user.user.id}")
        return ValidateResponse(valid=valid)
    except Exception as e:
        logger.error(f"RSS validation failed: url={request.url}, error={e}, user={user.user.id}")
        return ValidateResponse(valid=False)


@router.post("/parse", response_model=ParseResponse)
async def parse_rss(request: ParseRequest, user=Depends(verify_jwt)):
    """
    Parse an RSS/Atom feed and return feed metadata with articles.

    Returns:
        ParseResponse with feed metadata and list of articles
    """
    try:
        result = parse_rss_feed(str(request.url), str(request.feedId))
        logger.info(
            f"RSS parsed: url={request.url}, "
            f"articles={len(result['articles'])}, "
            f"user={user.user.id}"
        )
        return ParseResponse(**result)
    except ValueError as e:
        # Parse error - client issue
        logger.warning(f"RSS parse failed (ValueError): url={request.url}, error={e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Unexpected error - server issue
        logger.error(f"RSS parse failed: url={request.url}, error={e}, user={user.user.id}")
        raise HTTPException(status_code=500, detail=str(e))
