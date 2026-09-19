"""Locating and (if necessary) downloading the translation model.

The model is a 4.3 GB GGUF. Bundling it makes the package far larger than a
GitHub release asset may be, so the shipped builds are "lite": the app finds
the model in one of several places, and offers to download it on first run if
it is missing.

Search order:

1. ``models/`` next to the app (a "full" build, or a source checkout)
2. ``~/.ykd-ai/models/`` (where the downloader puts it)

The AppImage mount is read-only, so downloads always go to the user directory.
"""

from __future__ import annotations

import os
import shutil
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

MODEL_FILENAME = "Hy-MT2-7B-Q4_K_M.gguf"

# A verified direct download of the Q4_K_M quant of tencent/Hunyuan-MT-7B.
MODEL_URL = (
    "https://huggingface.co/mradermacher/Hunyuan-MT-7B-GGUF/resolve/main/"
    "Hunyuan-MT-7B.Q4_K_M.gguf"
)
MODEL_LICENSE = "Tencent Hunyuan Community License"
MODEL_HOMEPAGE = "https://huggingface.co/tencent/Hunyuan-MT-7B"

# Accepted size window, so a truncated or HTML-error download is rejected.
_EXPECTED_BYTES = 4_624_950_272
_SIZE_TOLERANCE = 0.02          # 2%


def bundle_root() -> Path:
    """Root for bundled data, correct both frozen and running from source."""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent


def user_data_dir() -> Path:
    """Per-user data directory (``$YKD_DATA_DIR`` overrides, for tests)."""
    override = os.environ.get("YKD_DATA_DIR")
    if override:
        return Path(override)
    return Path(os.path.expanduser("~")) / ".ykd-ai"


def user_model_path() -> Path:
    return user_data_dir() / "models" / MODEL_FILENAME


def bundled_model_path() -> Path:
    return bundle_root() / "models" / MODEL_FILENAME


def find_model() -> Path | None:
    """Return the first existing model file, or None."""
    for candidate in (bundled_model_path(), user_model_path()):
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


def model_present() -> bool:
    return find_model() is not None


def human(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def download(dest: Path | None = None, on_progress=None,
             on_done=None, on_error=None, cancel: threading.Event | None = None):
    """Download the model in a background thread.

    ``on_progress(downloaded_bytes, total_bytes, speed_bps)`` is called
    periodically. ``on_done(path)`` / ``on_error(message)`` finish the job.
    Callbacks arrive on the worker thread — the UI must marshal them.
    """
    target = dest or user_model_path()

    def work():
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_suffix(target.suffix + ".part")

            request = urllib.request.Request(
                MODEL_URL, headers={"User-Agent": "YKD-AI-Translator"}
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                total = int(response.headers.get("Content-Length") or 0)
                if total and not _size_ok(total):
                    raise ValueError(
                        f"unexpected file size ({human(total)}) — the download "
                        "URL may have changed"
                    )
                downloaded = 0
                chunk = 1024 * 512
                last_report = 0.0
                import time as _time
                started = _time.monotonic()

                with open(partial, "wb") as fh:
                    while True:
                        if cancel is not None and cancel.is_set():
                            fh.close()
                            partial.unlink(missing_ok=True)
                            if on_error:
                                on_error("cancelled")
                            return
                        block = response.read(chunk)
                        if not block:
                            break
                        fh.write(block)
                        downloaded += len(block)
                        now = _time.monotonic()
                        if on_progress and (now - last_report) > 0.25:
                            elapsed = max(now - started, 1e-6)
                            on_progress(downloaded, total, downloaded / elapsed)
                            last_report = now

            # Validate before publishing the file.
            size = partial.stat().st_size
            if not _size_ok(size):
                partial.unlink(missing_ok=True)
                raise ValueError(
                    f"downloaded file is {human(size)}, expected about "
                    f"{human(_EXPECTED_BYTES)} — download may be truncated"
                )
            with open(partial, "rb") as fh:
                if fh.read(4) != b"GGUF":
                    partial.unlink(missing_ok=True)
                    raise ValueError("downloaded file is not a GGUF model")

            shutil.move(str(partial), str(target))
            if on_done:
                on_done(target)

        except urllib.error.URLError as exc:
            if on_error:
                on_error(f"network error: {exc.reason}")
        except Exception as exc:                            # noqa: BLE001
            if on_error:
                on_error(str(exc))

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    return thread


def _size_ok(size: int) -> bool:
    if size <= 0:
        return False
    return abs(size - _EXPECTED_BYTES) <= _EXPECTED_BYTES * _SIZE_TOLERANCE


def delete_model() -> bool:
    """Remove a downloaded model. Returns True if something was removed."""
    path = user_model_path()
    if path.exists():
        path.unlink()
        return True
    return False


def disk_space_ok() -> tuple[bool, str]:
    """Whether there is room for the model, with a message for the UI."""
    target = user_model_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(target.parent).free
    except OSError as exc:
        return False, f"cannot inspect disk: {exc}"
    needed = _EXPECTED_BYTES * 1.1        # headroom for the .part file
    if free < needed:
        return False, (
            f"needs about {human(needed)} free, only {human(free)} available"
        )
    return True, human(free)
