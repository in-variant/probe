import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import workspaces, documents, search
from sync import sync_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up: hydrating local cache from GCS...")
    sync_engine.hydrate()
    sync_engine.start()
    logger.info("Sync engine started.")
    yield
    logger.info("Shutting down: flushing dirty queue to GCS...")
    sync_engine.stop()
    logger.info("Shutdown complete.")


app = FastAPI(title="Probe API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workspaces.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(search.router, prefix="/api")


@app.get("/api/health")
async def health():
    if not sync_engine.is_hydrated:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "hydrating", "ready": False},
        )
    return {"status": "ok", "ready": True}
