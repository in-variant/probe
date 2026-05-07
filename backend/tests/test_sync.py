import json
import threading
from unittest.mock import MagicMock, patch, PropertyMock

import local_cache
from sync import SyncEngine, SyncOp, OpType


class TestSyncEngineState:
    def test_starts_not_hydrated(self):
        engine = SyncEngine()
        assert engine.is_hydrated is False

    def test_enqueue_stores_ops(self):
        engine = SyncEngine()
        op = SyncOp(op=OpType.WRITE_JSON, path="test.json", data={"k": "v"})
        engine.enqueue(op)
        assert len(engine._dirty_queue) == 1

    def test_enqueue_is_thread_safe(self):
        engine = SyncEngine()
        barrier = threading.Barrier(4)

        def _push(i):
            barrier.wait()
            engine.enqueue(SyncOp(op=OpType.DELETE, path=f"f{i}"))

        threads = [threading.Thread(target=_push, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(engine._dirty_queue) == 4


class TestHydrate:
    def test_sets_hydrated_flag(self, mock_gcs_bucket):
        mock_gcs_bucket.list_blobs.return_value = []
        engine = SyncEngine()
        engine.hydrate()
        assert engine.is_hydrated is True

    def test_downloads_blobs(self, mock_gcs_bucket):
        blob = MagicMock()
        blob.name = "workspace/ws1/file.txt"
        blob.download_as_bytes.return_value = b"hello"
        blob.content_type = "text/plain"
        blob.size = 5
        blob.metadata = {"status": "uploaded"}
        blob.time_created = None
        blob.updated = None
        mock_gcs_bucket.list_blobs.return_value = [blob]

        engine = SyncEngine()
        engine.hydrate()

        cache_dir = local_cache.LOCAL_CACHE_DIR
        fp = cache_dir / "workspace" / "ws1" / "file.txt"
        assert fp.read_bytes() == b"hello"


class TestFlush:
    def test_flush_write_json(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine.enqueue(SyncOp(op=OpType.WRITE_JSON, path="test.json", data={"k": 1}))
        engine._flush()

        mock_gcs_bucket.blob.assert_called_with("test.json")
        mock_gcs_bucket.blob.return_value.upload_from_string.assert_called_once()

    def test_flush_write_file(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine.enqueue(SyncOp(
            op=OpType.WRITE_FILE,
            path="file.bin",
            data=b"\x00",
            metadata={"content_type": "application/pdf", "status": "ok"},
        ))
        engine._flush()
        mock_gcs_bucket.blob.return_value.upload_from_string.assert_called_once()

    def test_flush_delete(self, mock_gcs_bucket):
        blob_mock = MagicMock()
        blob_mock.exists.return_value = True
        mock_gcs_bucket.blob.return_value = blob_mock

        engine = SyncEngine()
        engine.enqueue(SyncOp(op=OpType.DELETE, path="old.txt"))
        engine._flush()
        blob_mock.delete.assert_called_once()

    def test_flush_delete_nonexistent_skips(self, mock_gcs_bucket):
        blob_mock = MagicMock()
        blob_mock.exists.return_value = False
        mock_gcs_bucket.blob.return_value = blob_mock

        engine = SyncEngine()
        engine.enqueue(SyncOp(op=OpType.DELETE, path="ghost.txt"))
        engine._flush()
        blob_mock.delete.assert_not_called()

    def test_flush_rename(self, mock_gcs_bucket):
        blob_mock = MagicMock()
        blob_mock.exists.return_value = True
        mock_gcs_bucket.blob.return_value = blob_mock

        engine = SyncEngine()
        engine.enqueue(SyncOp(op=OpType.RENAME, path="old", new_path="new"))
        engine._flush()
        mock_gcs_bucket.rename_blob.assert_called_once_with(blob_mock, "new")

    def test_flush_clears_queue(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine.enqueue(SyncOp(op=OpType.DELETE, path="x"))
        engine._flush()
        assert len(engine._dirty_queue) == 0

    def test_flush_empty_is_noop(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine._flush()
        mock_gcs_bucket.blob.assert_not_called()


class TestStartStop:
    def test_start_creates_thread(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine._hydrated.set()
        engine.start()
        assert engine._thread is not None
        assert engine._thread.is_alive()
        engine.stop()

    def test_stop_joins_thread(self, mock_gcs_bucket):
        engine = SyncEngine()
        engine._hydrated.set()
        engine.start()
        engine.stop()
        assert not engine._thread.is_alive()
