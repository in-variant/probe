import io
import pytest
from httpx import AsyncClient

import local_cache
from storage import workspace_prefix, workspace_meta_path, write_json_blob, write_file_blob


def _seed_workspace(ws_id: str, name: str = "Test WS"):
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(workspace_meta_path(ws_id), {
        "id": ws_id,
        "name": name,
        "slug": ws_id,
        "status": "active",
        "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
        "file_count": 0,
        "folder_count": 0,
    })


def _seed_file(ws_id: str, path: str, content: bytes = b"hello", status: str = "uploaded"):
    prefix = workspace_prefix(ws_id)
    file_path = f"{prefix}{path.lstrip('/')}"
    write_file_blob(file_path, content, {
        "status": status,
        "original_name": path.split("/")[-1],
        "content_type": "text/plain",
        "size": len(content),
        "time_created": "2025-01-01T00:00:00+00:00",
        "updated": "2025-01-01T00:00:00+00:00",
    })


class TestListDocuments:
    @pytest.mark.asyncio
    async def test_empty_workspace(self, client: AsyncClient):
        _seed_workspace("ws-docs")
        resp = await client.get("/api/workspaces/ws-docs/documents")
        assert resp.status_code == 200
        data = resp.json()
        assert data["folders"] == []
        assert data["files"] == []

    @pytest.mark.asyncio
    async def test_workspace_not_found(self, client: AsyncClient):
        resp = await client.get("/api/workspaces/nope/documents")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_lists_files(self, client: AsyncClient):
        _seed_workspace("ws-lf")
        _seed_file("ws-lf", "report.pdf")
        resp = await client.get("/api/workspaces/ws-lf/documents")
        assert resp.status_code == 200
        files = resp.json()["files"]
        assert len(files) == 1
        assert files[0]["name"] == "report.pdf"

    @pytest.mark.asyncio
    async def test_lists_folders(self, client: AsyncClient):
        _seed_workspace("ws-ld")
        prefix = workspace_prefix("ws-ld")
        write_file_blob(f"{prefix}myfolder/.keep", b"")
        write_file_blob(f"{prefix}myfolder/nested/a.txt", b"a")
        write_file_blob(f"{prefix}myfolder/nested/b.txt", b"b")
        write_json_blob(f"{prefix}myfolder/.folder-meta.json", {
            "name": "myfolder",
            "created_at": "2025-01-01T00:00:00+00:00",
            "updated_at": "2025-01-01T00:00:00+00:00",
        })
        resp = await client.get("/api/workspaces/ws-ld/documents")
        folders = resp.json()["folders"]
        assert len(folders) == 1
        assert folders[0]["name"] == "myfolder"
        assert folders[0]["file_count"] == 2

    @pytest.mark.asyncio
    async def test_subpath_listing(self, client: AsyncClient):
        _seed_workspace("ws-sub")
        _seed_file("ws-sub", "folder/inner.txt")
        resp = await client.get("/api/workspaces/ws-sub/documents", params={"path": "/folder"})
        assert resp.status_code == 200
        files = resp.json()["files"]
        assert len(files) == 1
        assert files[0]["name"] == "inner.txt"


class TestCreateFolder:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-cf")
        resp = await client.post(
            "/api/workspaces/ws-cf/folders",
            json={"name": "new-folder"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "new-folder"
        assert data["type"] == "folder"

    @pytest.mark.asyncio
    async def test_duplicate_409(self, client: AsyncClient):
        _seed_workspace("ws-dup")
        prefix = workspace_prefix("ws-dup")
        write_file_blob(f"{prefix}existing/.keep", b"")
        resp = await client.post(
            "/api/workspaces/ws-dup/folders",
            json={"name": "existing"},
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_workspace_not_found(self, client: AsyncClient):
        resp = await client.post(
            "/api/workspaces/nope/folders",
            json={"name": "folder"},
        )
        assert resp.status_code == 404


class TestRenameFolder:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-rf")
        prefix = workspace_prefix("ws-rf")
        write_file_blob(f"{prefix}old-name/.keep", b"")
        resp = await client.patch(
            "/api/workspaces/ws-rf/folders",
            json={"new_name": "new-name"},
            params={"path": "old-name"},
        )
        assert resp.status_code == 200
        assert resp.json()["renamed"] is True

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-rfnf")
        resp = await client.patch(
            "/api/workspaces/ws-rfnf/folders",
            json={"new_name": "x"},
            params={"path": "ghost"},
        )
        assert resp.status_code == 404


class TestDeleteFolder:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-df")
        prefix = workspace_prefix("ws-df")
        write_file_blob(f"{prefix}trash/.keep", b"")
        resp = await client.delete(
            "/api/workspaces/ws-df/folders",
            params={"path": "trash"},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == "trash"

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-dfnf")
        resp = await client.delete(
            "/api/workspaces/ws-dfnf/folders",
            params={"path": "nope"},
        )
        assert resp.status_code == 404


class TestUploadFiles:
    @pytest.mark.asyncio
    async def test_single_upload(self, client: AsyncClient):
        _seed_workspace("ws-up")
        resp = await client.post(
            "/api/workspaces/ws-up/files",
            files={"files": ("hello.txt", b"hello world", "text/plain")},
            data={"path": "/", "status": "uploaded"},
        )
        assert resp.status_code == 201
        uploaded = resp.json()["uploaded"]
        assert len(uploaded) == 1
        assert uploaded[0]["name"] == "hello.txt"
        assert uploaded[0]["size"] == 11

    @pytest.mark.asyncio
    async def test_multiple_upload(self, client: AsyncClient):
        _seed_workspace("ws-mu")
        resp = await client.post(
            "/api/workspaces/ws-mu/files",
            files=[
                ("files", ("a.txt", b"aaa", "text/plain")),
                ("files", ("b.txt", b"bbb", "text/plain")),
            ],
            data={"path": "/"},
        )
        assert resp.status_code == 201
        assert len(resp.json()["uploaded"]) == 2

    @pytest.mark.asyncio
    async def test_workspace_not_found(self, client: AsyncClient):
        resp = await client.post(
            "/api/workspaces/nope/files",
            files={"files": ("x.txt", b"x", "text/plain")},
        )
        assert resp.status_code == 404


class TestGetFile:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-gf")
        _seed_file("ws-gf", "doc.txt", b"content")
        resp = await client.get(
            "/api/workspaces/ws-gf/files",
            params={"path": "doc.txt"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "doc.txt"
        assert data["size"] == 7

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-gfnf")
        resp = await client.get(
            "/api/workspaces/ws-gfnf/files",
            params={"path": "nope.txt"},
        )
        assert resp.status_code == 404


class TestGetFileContent:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-gfc")
        _seed_file("ws-gfc", "notes.md", b"# hello")
        resp = await client.get(
            "/api/workspaces/ws-gfc/files/content",
            params={"path": "notes.md"},
        )
        assert resp.status_code == 200
        assert resp.text == "# hello"
        assert resp.headers.get("content-type", "").startswith("text/plain")

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-gfcnf")
        resp = await client.get(
            "/api/workspaces/ws-gfcnf/files/content",
            params={"path": "missing.md"},
        )
        assert resp.status_code == 404


class TestUpdateFile:
    @pytest.mark.asyncio
    async def test_update_status(self, client: AsyncClient):
        _seed_workspace("ws-uf")
        _seed_file("ws-uf", "file.txt")
        resp = await client.patch(
            "/api/workspaces/ws-uf/files",
            json={"status": "reviewed"},
            params={"path": "file.txt"},
        )
        assert resp.status_code == 200
        assert resp.json()["updated"] is True

    @pytest.mark.asyncio
    async def test_rename_file(self, client: AsyncClient):
        _seed_workspace("ws-rn")
        _seed_file("ws-rn", "old.txt")
        resp = await client.patch(
            "/api/workspaces/ws-rn/files",
            json={"name": "new.txt"},
            params={"path": "old.txt"},
        )
        assert resp.status_code == 200
        assert resp.json()["renamed"] is True

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-ufnf")
        resp = await client.patch(
            "/api/workspaces/ws-ufnf/files",
            json={"status": "x"},
            params={"path": "ghost.txt"},
        )
        assert resp.status_code == 404


class TestDeleteFile:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-delf")
        _seed_file("ws-delf", "bye.txt")
        resp = await client.delete(
            "/api/workspaces/ws-delf/files",
            params={"path": "bye.txt"},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == "bye.txt"

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-delfnf")
        resp = await client.delete(
            "/api/workspaces/ws-delfnf/files",
            params={"path": "nope"},
        )
        assert resp.status_code == 404


class TestBulkDelete:
    @pytest.mark.asyncio
    async def test_deletes_existing_only(self, client: AsyncClient):
        _seed_workspace("ws-bd")
        _seed_file("ws-bd", "a.txt")
        _seed_file("ws-bd", "b.txt")
        resp = await client.post(
            "/api/workspaces/ws-bd/files/bulk-delete",
            json={"paths": ["a.txt", "b.txt", "missing.txt"]},
        )
        assert resp.status_code == 200
        deleted = resp.json()["deleted"]
        assert "a.txt" in deleted
        assert "b.txt" in deleted
        assert "missing.txt" not in deleted


class TestMoveFiles:
    @pytest.mark.asyncio
    async def test_move_to_folder(self, client: AsyncClient):
        _seed_workspace("ws-mv")
        _seed_file("ws-mv", "file.txt")
        prefix = workspace_prefix("ws-mv")
        write_file_blob(f"{prefix}dest/.keep", b"")
        resp = await client.post(
            "/api/workspaces/ws-mv/files/move",
            json={"source_paths": ["file.txt"], "destination_folder": "dest"},
        )
        assert resp.status_code == 200
        moved = resp.json()["moved"]
        assert len(moved) == 1
        assert moved[0]["to"] == "dest/file.txt"

    @pytest.mark.asyncio
    async def test_skip_missing_source(self, client: AsyncClient):
        _seed_workspace("ws-mvs")
        resp = await client.post(
            "/api/workspaces/ws-mvs/files/move",
            json={"source_paths": ["nope.txt"], "destination_folder": "dest"},
        )
        assert resp.status_code == 200
        assert resp.json()["moved"] == []


class TestDownloadUrl:
    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        _seed_workspace("ws-dl")
        resp = await client.get(
            "/api/workspaces/ws-dl/files/download-url",
            params={"path": "missing.txt"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        from unittest.mock import patch, MagicMock
        _seed_workspace("ws-dls")
        _seed_file("ws-dls", "dl.txt")
        bucket_mock = MagicMock()
        bucket_mock.blob.return_value.generate_signed_url.return_value = "https://signed.url"
        with patch("routers.documents.get_bucket", return_value=bucket_mock):
            resp = await client.get(
                "/api/workspaces/ws-dls/files/download-url",
                params={"path": "dl.txt"},
            )
        assert resp.status_code == 200
        assert resp.json()["url"] == "https://signed.url"
        assert resp.json()["expires_in"] == 3600


class TestZipImport:
    @pytest.mark.asyncio
    async def test_import_zip_extracts_to_named_folder(self, client: AsyncClient):
        import zipfile

        _seed_workspace("ws-zip")
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as zf:
            zf.writestr("sub/hello.txt", "hello")
            zf.writestr("readme.md", "# readme")
        payload.seek(0)

        resp = await client.post(
            "/api/workspaces/ws-zip/files/import-zip",
            files={"file": ("bundle.zip", payload.getvalue(), "application/zip")},
            data={"path": "/target"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["folder_path"] == "target/bundle"
        assert body["imported_count"] == 2

        listing = await client.get("/api/workspaces/ws-zip/documents", params={"path": "/target/bundle"})
        assert listing.status_code == 200
        root_files = listing.json()["files"]
        root_folders = listing.json()["folders"]
        assert any(f["name"] == "readme.md" for f in root_files)
        assert any(f["name"] == "sub" for f in root_folders)
