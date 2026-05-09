from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass

import local_cache
from rag.indexer import delete_indexed_path, index_file, list_workspace_files

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexJob:
    workspace_id: str
    path: str
    op: str = "index"

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.workspace_id, self.path.lstrip("/"), self.op)


class IndexJobQueue:
    def __init__(self, workers: int = 4, maxsize: int | None = None):
        queue_size = maxsize if maxsize is not None else int(os.getenv("RAG_INDEX_QUEUE_MAXSIZE", "1000"))
        self.queue: asyncio.Queue[IndexJob] = asyncio.Queue(maxsize=queue_size)
        self.workers = workers
        self._tasks: list[asyncio.Task] = []
        self._pending: set[tuple[str, str, str]] = set()
        self._started = False
        self.processed = 0
        self.failed = 0

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        for i in range(self.workers):
            self._tasks.append(asyncio.create_task(self._worker(i)))
        logger.info("rag_queue_started workers=%s", self.workers)

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self._started = False
        self._pending.clear()
        logger.info("rag_queue_stopped processed=%s failed=%s", self.processed, self.failed)

    def enqueue(self, workspace_id: str, path: str, op: str = "index") -> bool:
        job = IndexJob(workspace_id, path.lstrip("/"), op)
        if job.key in self._pending:
            return False
        self._pending.add(job.key)
        try:
            self.queue.put_nowait(job)
        except asyncio.QueueFull:
            self._pending.discard(job.key)
            logger.warning("rag_job_queue_full workspace=%s path=%s op=%s", workspace_id, job.path, op)
            return False
        logger.info("rag_job_enqueued workspace=%s path=%s op=%s queue_size=%s", workspace_id, job.path, op, self.queue.qsize())
        return True

    async def _worker(self, worker_id: int) -> None:
        while True:
            job = await self.queue.get()
            started = time.monotonic()
            try:
                if job.op == "delete":
                    await asyncio.to_thread(delete_indexed_path, job.workspace_id, job.path)
                else:
                    await asyncio.to_thread(index_file, job.workspace_id, job.path)
                self.processed += 1
                logger.info(
                    "rag_job_done worker=%s workspace=%s path=%s op=%s duration_ms=%s",
                    worker_id,
                    job.workspace_id,
                    job.path,
                    job.op,
                    int((time.monotonic() - started) * 1000),
                )
            except Exception as exc:
                self.failed += 1
                logger.exception(
                    "rag_job_failed worker=%s workspace=%s path=%s op=%s error=%s",
                    worker_id,
                    job.workspace_id,
                    job.path,
                    job.op,
                    type(exc).__name__,
                )
            finally:
                self._pending.discard(job.key)
                self.queue.task_done()

    def enqueue_workspace(self, workspace_id: str) -> int:
        count = 0
        for path in list_workspace_files(workspace_id):
            if self.enqueue(workspace_id, path):
                count += 1
        logger.info("rag_workspace_enqueued workspace=%s files=%s", workspace_id, count)
        return count


index_queue = IndexJobQueue()


async def start_index_queue() -> None:
    index_queue.start()


async def stop_index_queue() -> None:
    await index_queue.stop()


def enqueue_index(workspace_id: str, path: str) -> bool:
    return index_queue.enqueue(workspace_id, path, "index")


def enqueue_delete(workspace_id: str, path: str) -> bool:
    return index_queue.enqueue(workspace_id, path, "delete")


async def bootstrap_all_workspaces(workspace_root: str = "workspace") -> int:
    dirs, _ = local_cache.list_dir(workspace_root)
    total = 0
    for workspace_id in dirs:
        if workspace_id.startswith("."):
            continue
        total += index_queue.enqueue_workspace(workspace_id)
        await asyncio.sleep(0)
    logger.info("rag_bootstrap_enqueued workspaces=%s files=%s", len(dirs), total)
    return total

