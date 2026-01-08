import os
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

from app.exceptions import AppException
from app.exception_handlers import app_exception_handler, unhandled_exception_handler

# Configure logging (file + console, daily rotation)
from app.core.logging_config import setup_logging
setup_logging()

logger = logging.getLogger(__name__)

# Import realtime forwarder for lifecycle management
from app.services.supabase_realtime import realtime_forwarder


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown events."""
    # Startup: Start Supabase Realtime subscription
    logger.info("Starting Supabase Realtime forwarder...")
    await realtime_forwarder.start()

    yield

    # Shutdown: Stop Supabase Realtime subscription
    logger.info("Stopping Supabase Realtime forwarder...")
    await realtime_forwarder.stop()


app = FastAPI(
    title="SaveHub Backend API",
    description="FastAPI backend for RSS parsing (uses Supabase Python SDK)",
    version="1.0.0",
    lifespan=lifespan,
)

# Register global exception handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

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
from app.api.routers import api_configs, proxy, rag, github, repositories, rag_chat, chat
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
app.include_router(rag_chat.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/health")
async def health_check():
    """Root health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/health")
async def api_health_check():
    """API health check endpoint."""
    return {"status": "healthy", "service": "rss-api"}