from unittest.mock import patch

import local_cache
import storage
from sync import OpType


class TestWorkspaceHelpers:
    def test_workspace_prefix(self):
        assert storage.workspace_prefix("my-ws") == "workspace/my-ws/"

    def test_workspace_meta_path(self):
        assert storage.workspace_meta_path("my-ws") == "workspace/my-ws/.meta.json"


class TestReadJsonBlob:
    def test_delegates_to_local_cache(self):
        local_cache.write_json("workspace/ws1/.meta.json", {"name": "WS1"})
        result = storage.read_json_blob("workspace/ws1/.meta.json")
        assert result == {"name": "WS1"}

    def test_returns_none_for_missing(self):
        assert storage.read_json_blob("nope") is None


class TestWriteJsonBlob:
    def test_writes_locally_and_enqueues(self, stub_sync):
        storage.write_json_blob("workspace/ws/test.json", {"x": 1})
        assert local_cache.read_json("workspace/ws/test.json") == {"x": 1}
        assert len(stub_sync.ops) == 1
        assert stub_sync.ops[0].op == OpType.WRITE_JSON


class TestWriteFileBlob:
    def test_writes_locally_and_enqueues(self, stub_sync):
        storage.write_file_blob("workspace/ws/f.bin", b"data", {"content_type": "application/pdf"})
        assert local_cache.read_file("workspace/ws/f.bin") == b"data"
        assert len(stub_sync.ops) == 1
        assert stub_sync.ops[0].op == OpType.WRITE_FILE
        assert stub_sync.ops[0].metadata["content_type"] == "application/pdf"


class TestDeleteBlob:
    def test_deletes_locally_and_enqueues(self, stub_sync):
        local_cache.write_file("workspace/ws/f.txt", b"x")
        storage.delete_blob("workspace/ws/f.txt")
        assert not local_cache.exists("workspace/ws/f.txt")
        assert len(stub_sync.ops) == 1
        assert stub_sync.ops[0].op == OpType.DELETE


class TestDeletePrefix:
    def test_removes_tree_and_enqueues_per_file(self, stub_sync):
        local_cache.write_file("workspace/ws/a.txt", b"a")
        local_cache.write_file("workspace/ws/b.txt", b"b")
        storage.delete_prefix("workspace/ws")
        assert not local_cache.exists("workspace/ws")
        assert len(stub_sync.ops) == 2
        assert all(op.op == OpType.DELETE for op in stub_sync.ops)


class TestRenameBlob:
    def test_renames_locally_and_enqueues(self, stub_sync):
        local_cache.write_file("workspace/ws/old.txt", b"data")
        storage.rename_blob("workspace/ws/old.txt", "workspace/ws/new.txt")
        assert not local_cache.exists("workspace/ws/old.txt")
        assert local_cache.read_file("workspace/ws/new.txt") == b"data"
        assert len(stub_sync.ops) == 1
        assert stub_sync.ops[0].op == OpType.RENAME


class TestRenamePrefix:
    def test_renames_all_files(self, stub_sync):
        local_cache.write_file("workspace/ws/old/a.txt", b"a")
        local_cache.write_file("workspace/ws/old/b.txt", b"b")
        storage.rename_prefix("workspace/ws/old/", "workspace/ws/new/")
        assert not local_cache.exists("workspace/ws/old/a.txt")
        assert not local_cache.exists("workspace/ws/old/b.txt")
        assert local_cache.read_file("workspace/ws/new/a.txt") == b"a"
        assert local_cache.read_file("workspace/ws/new/b.txt") == b"b"
        assert len(stub_sync.ops) == 2
        assert all(op.op == OpType.RENAME for op in stub_sync.ops)


class TestBlobExists:
    def test_true_when_exists(self):
        local_cache.write_file("workspace/ws/x.txt", b"x")
        assert storage.blob_exists("workspace/ws/x.txt") is True

    def test_false_when_missing(self):
        assert storage.blob_exists("nope") is False


class TestNowIso:
    def test_returns_iso_string(self):
        ts = storage.now_iso()
        assert "T" in ts
        assert ts.endswith("+00:00")
