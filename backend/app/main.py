import os
import asyncio
from dotenv import load_dotenv, find_dotenv

# Load environment variables FIRST
_ = load_dotenv(find_dotenv())

# IMPORTANT: Monkey-patch httpx default timeout BEFORE importing any supabase modules
# This fixes SSL handshake timeout in slow network environments (e.g., China mainland)
# See: https://github.com/supabase/supabase-py/issues/487
import httpx
_HTTPX_TIMEOUT = float(os.environ.get("HTTPX_TIMEOUT", "45"))
httpx._config.DEFAULT_TIMEOUT_CONFIG = httpx.Timeout(_HTTPX_TIMEOUT)

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure logging (file + console, daily rotation)
from app.core.logging_config import setup_logging
setup_logging()

logger = logging.getLogger(__name__)

# Import realtime forwarder for lifecycle management
from app.services.supabase_realtime import realtime_forwarder


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown events."""
    realtime_enabled = (
        os.environ.get("SUPABASE_REALTIME_ENABLED", "true").lower() == "true"
    )
    realtime_startup_timeout = float(
        os.environ.get("SUPABASE_REALTIME_STARTUP_TIMEOUT", "8")
    )

    # Startup: Start Supabase Realtime subscription (non-blocking fail-safe)
    if realtime_enabled:
        logger.info("Starting Supabase Realtime forwarder...")
        try:
            await asyncio.wait_for(
                realtime_forwarder.start(),
                timeout=realtime_startup_timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Supabase Realtime startup timed out after %.1fs; "
                "continue without realtime",
                realtime_startup_timeout,
            )
        except Exception:
            logger.exception(
                "Supabase Realtime startup failed; continue without realtime"
            )
    else:
        logger.info("Supabase Realtime forwarder is disabled by config")

    yield

    # Shutdown: Stop Supabase Realtime subscription
    if realtime_enabled and realtime_forwarder.is_running:
        logger.info("Stopping Supabase Realtime forwarder...")
        try:
            await realtime_forwarder.stop()
        except Exception:
            logger.exception("Supabase Realtime shutdown error")


app = FastAPI(
    title="SaveHub Backend API",
    description="FastAPI backend for RSS parsing (uses Supabase Python SDK)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and register routers
from app.api.routers import rss, auth, feeds, folders, articles, settings, websocket
from app.api.routers import queue, health as queue_health
from app.api.routers import (
    api_configs,
    proxy,
    rag,
    github,
    repositories,
    agentic_rag_chat,
)
app.include_router(rss.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(feeds.router, prefix="/api")
app.include_router(folders.router, prefix="/api")
app.include_router(articles.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(api_configs.router, prefix="/api")
app.include_router(websocket.router, prefix="/api")
app.include_router(queue.router, prefix="/api")
app.include_router(queue_health.router, prefix="/api")
app.include_router(proxy.router, prefix="/api")
app.include_router(rag.router, prefix="/api")
app.include_router(github.router, prefix="/api")
app.include_router(repositories.router, prefix="/api")
app.include_router(agentic_rag_chat.router, prefix="/api")


@app.get("/health")
async def health_check():
    """Root health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/health")
async def api_health_check():
    """API health check endpoint."""
    return {"status": "healthy", "service": "rss-api"}
