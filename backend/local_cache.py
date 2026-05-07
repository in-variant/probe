"""
Local filesystem cache layer that mirrors the GCS bucket key structure.
All reads and writes go through these helpers — no direct GCS in the request path.
"""

import json
import os
import shutil
from pathlib import Path
from typing import Any

LOCAL_CACHE_DIR = Path("/tmp/probe-cache")


def _full_path(relative: str) -> Path:
    return LOCAL_CACHE_DIR / relative


def ensure_cache_dir():
    LOCAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def read_json(relative: str) -> dict | None:
    fp = _full_path(relative)
    if not fp.exists():
        return None
    return json.loads(fp.read_text(encoding="utf-8"))


def write_json(relative: str, data: dict) -> None:
    fp = _full_path(relative)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(json.dumps(data, default=str), encoding="utf-8")


def read_file(relative: str) -> bytes | None:
    fp = _full_path(relative)
    if not fp.exists():
        return None
    return fp.read_bytes()


def write_file(relative: str, content: bytes, metadata: dict[str, Any] | None = None) -> None:
    fp = _full_path(relative)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_bytes(content)
    if metadata:
        _write_metadata(relative, metadata)


def _metadata_path(relative: str) -> Path:
    fp = _full_path(relative)
    return fp.parent / f".{fp.name}.meta.json"


def _write_metadata(relative: str, metadata: dict[str, Any]) -> None:
    mp = _metadata_path(relative)
    mp.parent.mkdir(parents=True, exist_ok=True)
    mp.write_text(json.dumps(metadata, default=str), encoding="utf-8")


def read_metadata(relative: str) -> dict[str, Any]:
    mp = _metadata_path(relative)
    if not mp.exists():
        return {}
    return json.loads(mp.read_text(encoding="utf-8"))


def exists(relative: str) -> bool:
    return _full_path(relative).exists()


def delete_path(relative: str) -> None:
    fp = _full_path(relative)
    if fp.is_dir():
        shutil.rmtree(fp, ignore_errors=True)
    elif fp.exists():
        fp.unlink(missing_ok=True)
    mp = _metadata_path(relative)
    if mp.exists():
        mp.unlink(missing_ok=True)


def rename_path(old_relative: str, new_relative: str) -> None:
    old_fp = _full_path(old_relative)
    new_fp = _full_path(new_relative)
    if not old_fp.exists():
        return
    new_fp.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(old_fp), str(new_fp))
    old_mp = _metadata_path(old_relative)
    if old_mp.exists():
        new_mp = _metadata_path(new_relative)
        new_mp.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_mp), str(new_mp))


def list_dir(relative: str) -> tuple[list[str], list[str]]:
    """List immediate children of a directory prefix.
    Returns (subdirectories, files) as lists of names (not full paths).
    Hidden files (starting with '.') are included.
    """
    dp = _full_path(relative)
    if not dp.exists() or not dp.is_dir():
        return [], []
    dirs = []
    files = []
    for entry in os.scandir(dp):
        if entry.is_dir():
            dirs.append(entry.name)
        else:
            files.append(entry.name)
    return dirs, files


def list_all_files(relative: str) -> list[str]:
    """Recursively list all files under a prefix, returning paths relative to LOCAL_CACHE_DIR."""
    dp = _full_path(relative)
    if not dp.exists():
        return []
    result = []
    for root, _, filenames in os.walk(dp):
        for fname in filenames:
            full = Path(root) / fname
            result.append(str(full.relative_to(LOCAL_CACHE_DIR)))
    return result


def get_file_size(relative: str) -> int | None:
    fp = _full_path(relative)
    if not fp.exists():
        return None
    return fp.stat().st_size


def get_file_mtime(relative: str) -> float | None:
    fp = _full_path(relative)
    if not fp.exists():
        return None
    return fp.stat().st_mtime
