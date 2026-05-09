import logging
import os
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from routers import workspaces, documents, search, gdrive, auth, document_requests, compliance_roadmap, admin_rag
from sync import sync_engine
from rag.jobs import bootstrap_all_workspaces, start_index_queue, stop_index_queue

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up: hydrating local cache from GCS...")
    sync_engine.hydrate()
    sync_engine.start()
    logger.info("Sync engine started.")
    await start_index_queue()
    bootstrap_task = asyncio.create_task(bootstrap_all_workspaces(), name="rag-bootstrap")
    logger.info("RAG indexing bootstrap scheduled.")
    yield
    logger.info("Shutting down: flushing dirty queue to GCS...")
    bootstrap_task.cancel()
    await asyncio.gather(bootstrap_task, return_exceptions=True)
    await stop_index_queue()
    sync_engine.stop()
    logger.info("Shutdown complete.")


app = FastAPI(title="Probe API", version="0.1.0", lifespan=lifespan)

_default_origins = [
    "http://localhost:3000",
    "https://probe-frontend-520296708682.us-central1.run.app",
]
_extra = os.getenv("CORS_ORIGINS", "")
cors_origins = _default_origins + [o.strip() for o in _extra.split(",") if o.strip()]

PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/callback"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if path in PUBLIC_PATHS:
            return await call_next(request)
        if not path.startswith("/api/"):
            return await call_next(request)
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
        token = auth_header[7:]
        if token not in auth.AUTH_SESSION_STORE:
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired session"})
        return await call_next(request)


app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(workspaces.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(gdrive.router, prefix="/api")
app.include_router(document_requests.router, prefix="/api")
app.include_router(compliance_roadmap.router, prefix="/api")
app.include_router(admin_rag.router, prefix="/api")


@app.get("/api/health")
async def health():
    if not sync_engine.is_hydrated:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "hydrating", "ready": False},
        )
    return {"status": "ok", "ready": True}
