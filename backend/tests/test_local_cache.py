import json
from pathlib import Path

import local_cache


class TestEnsureCacheDir:
    def test_creates_directory(self, tmp_path, monkeypatch):
        target = tmp_path / "sub" / "cache"
        monkeypatch.setattr(local_cache, "LOCAL_CACHE_DIR", target)
        local_cache.ensure_cache_dir()
        assert target.is_dir()

    def test_idempotent(self):
        local_cache.ensure_cache_dir()
        local_cache.ensure_cache_dir()
        assert local_cache.LOCAL_CACHE_DIR.is_dir()


class TestReadWriteJson:
    def test_round_trip(self):
        local_cache.write_json("a/b.json", {"key": "val"})
        assert local_cache.read_json("a/b.json") == {"key": "val"}

    def test_read_missing_returns_none(self):
        assert local_cache.read_json("does/not/exist.json") is None

    def test_overwrites_existing(self):
        local_cache.write_json("x.json", {"v": 1})
        local_cache.write_json("x.json", {"v": 2})
        assert local_cache.read_json("x.json") == {"v": 2}


class TestReadWriteFile:
    def test_round_trip(self):
        local_cache.write_file("dir/f.bin", b"\x00\x01\x02")
        assert local_cache.read_file("dir/f.bin") == b"\x00\x01\x02"

    def test_read_missing_returns_none(self):
        assert local_cache.read_file("nope") is None

    def test_write_with_metadata(self):
        local_cache.write_file("m.txt", b"data", {"status": "uploaded"})
        meta = local_cache.read_metadata("m.txt")
        assert meta["status"] == "uploaded"


class TestMetadata:
    def test_write_and_read(self):
        local_cache.write_file("f.txt", b"hello")
        local_cache._write_metadata("f.txt", {"content_type": "text/plain"})
        meta = local_cache.read_metadata("f.txt")
        assert meta["content_type"] == "text/plain"

    def test_read_missing_returns_empty(self):
        assert local_cache.read_metadata("no/file") == {}

    def test_metadata_path_is_hidden(self):
        mp = local_cache._metadata_path("dir/report.pdf")
        assert mp.name.startswith(".")
        assert mp.name == ".report.pdf.meta.json"


class TestExists:
    def test_existing_file(self):
        local_cache.write_file("e.txt", b"x")
        assert local_cache.exists("e.txt") is True

    def test_missing(self):
        assert local_cache.exists("missing") is False


class TestDeletePath:
    def test_delete_file(self):
        local_cache.write_file("d.txt", b"x")
        local_cache.delete_path("d.txt")
        assert not local_cache.exists("d.txt")

    def test_delete_file_with_metadata(self):
        local_cache.write_file("dm.txt", b"x", {"k": "v"})
        local_cache.delete_path("dm.txt")
        assert not local_cache.exists("dm.txt")
        assert local_cache.read_metadata("dm.txt") == {}

    def test_delete_directory(self):
        local_cache.write_file("dir/a.txt", b"a")
        local_cache.write_file("dir/b.txt", b"b")
        local_cache.delete_path("dir")
        assert not local_cache.exists("dir")

    def test_delete_nonexistent_is_noop(self):
        local_cache.delete_path("nope/nada")


class TestRenamePath:
    def test_rename_file(self):
        local_cache.write_file("old.txt", b"content")
        local_cache.rename_path("old.txt", "new.txt")
        assert not local_cache.exists("old.txt")
        assert local_cache.read_file("new.txt") == b"content"

    def test_rename_with_metadata(self):
        local_cache.write_file("a.txt", b"data", {"status": "ok"})
        local_cache.rename_path("a.txt", "b.txt")
        assert local_cache.read_metadata("b.txt")["status"] == "ok"
        assert local_cache.read_metadata("a.txt") == {}

    def test_rename_nonexistent_is_noop(self):
        local_cache.rename_path("ghost", "phantom")

    def test_rename_creates_parent_dirs(self):
        local_cache.write_file("src.txt", b"hi")
        local_cache.rename_path("src.txt", "deep/nested/dst.txt")
        assert local_cache.read_file("deep/nested/dst.txt") == b"hi"


class TestListDir:
    def test_list_files_and_dirs(self):
        local_cache.write_file("root/sub/a.txt", b"a")
        local_cache.write_file("root/b.txt", b"b")
        dirs, files = local_cache.list_dir("root")
        assert "sub" in dirs
        assert "b.txt" in files

    def test_list_nonexistent_returns_empty(self):
        assert local_cache.list_dir("nope") == ([], [])


class TestListAllFiles:
    def test_recursive_listing(self):
        local_cache.write_file("ws/a.txt", b"a")
        local_cache.write_file("ws/d/b.txt", b"b")
        all_files = local_cache.list_all_files("ws")
        assert len(all_files) == 2
        paths = {f.split("/")[-1] for f in all_files}
        assert paths == {"a.txt", "b.txt"}

    def test_nonexistent_returns_empty(self):
        assert local_cache.list_all_files("gone") == []


class TestFileSizeAndMtime:
    def test_size(self):
        local_cache.write_file("s.txt", b"12345")
        assert local_cache.get_file_size("s.txt") == 5

    def test_size_missing(self):
        assert local_cache.get_file_size("nope") is None

    def test_mtime(self):
        local_cache.write_file("t.txt", b"x")
        mtime = local_cache.get_file_mtime("t.txt")
        assert isinstance(mtime, float)

    def test_mtime_missing(self):
        assert local_cache.get_file_mtime("nope") is None
