"""
Global exception handlers for FastAPI application.

These handlers catch exceptions raised anywhere in the request lifecycle
(routes, dependencies, middleware) and return consistent JSON responses.

Registration (in main.py):
    from app.exceptions import AppException
    from app.exception_handlers import app_exception_handler, unhandled_exception_handler

    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
"""

import logging
from fastapi import Request
from fastapi.responses import JSONResponse

from app.exceptions import AppException

logger = logging.getLogger(__name__)


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """
    Handle application-level exceptions (AppException and subclasses).

    Logs the error with request context and returns a structured JSON response.

    Response format:
        {
            "detail": "Human-readable error message",
            "error_code": "MACHINE_READABLE_CODE"
        }
    """
    # Use warning level for client errors (4xx), error level for server errors (5xx)
    log_level = logging.WARNING if exc.status_code < 500 else logging.ERROR
    logger.log(
        log_level,
        f"{exc.error_code}: {exc.message}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "status_code": exc.status_code,
        },
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.message,
            "error_code": exc.error_code,
        },
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all handler for unhandled exceptions.

    Logs the full stack trace and returns a generic error response.
    This prevents internal details from leaking to clients.

    Note: HTTPException is handled by FastAPI's default handler,
    so it won't reach here.
    """
    logger.exception(
        f"Unhandled exception: {type(exc).__name__}: {exc}",
        extra={
            "path": request.url.path,
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error_code": "INTERNAL_ERROR",
        },
    )
