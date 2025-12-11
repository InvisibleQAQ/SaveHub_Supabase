import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv, find_dotenv

# Load environment variables
_ = load_dotenv(find_dotenv())

# Configure logging
logging.basicConfig(level=logging.INFO)
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
from app.api.routers import api_configs
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


@app.get("/health")
async def health_check():
    """Root health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/health")
async def api_health_check():
    """API health check endpoint."""
    return {"status": "healthy", "service": "rss-api"}