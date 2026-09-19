"""Model runtime: owns the bundled ``llama-server`` subprocess.

The app ships a prebuilt llama.cpp server (CUDA build) and drives it over its
OpenAI-compatible HTTP API on a loopback port. Nothing is downloaded at
runtime and no API key is involved — the model runs entirely on this machine.

Why a subprocess and not ``llama-cpp-python``: the Python binding has to be
compiled against a CUDA toolkit, which neither this machine nor most end users
have. A prebuilt binary needs no toolchain at all.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import requests

from .prompt import build

MODEL_FILENAME = "Hy-MT2-7B-Q4_K_M.gguf"

# Generation settings. Low temperature keeps translation deterministic.
TEMPERATURE = 0.3
MAX_TOKENS = 4096
CONTEXT_SIZE = 4096

# How long to wait for the model to load before calling it a failure.
STARTUP_TIMEOUT = 180.0

STATE_IDLE = "idle"
STATE_LOADING = "loading"
STATE_READY = "ready"
STATE_FAILED = "failed"


def _bundle_root() -> Path:
    """Root for bundled data, correct both frozen and running from source."""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent


def runtime_dir() -> Path:
    platform = "windows" if sys.platform == "win32" else "linux"
    return _bundle_root() / "runtime" / platform


def model_path() -> Path:
    """The model file to load, wherever it lives.

    Prefers a bundled copy, then the user directory used by the downloader.
    Falls back to the bundle path so error messages name a real location.
    """
    from .model_store import find_model

    found = find_model()
    return found if found else _bundle_root() / "models" / MODEL_FILENAME


def _free_port() -> int:
    """Ask the OS for an unused loopback port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Engine:
    """Manages the llama-server process and proxies translation requests.

    ``on_state`` is called with one of the STATE_* constants from a background
    thread; the UI must marshal back to the main thread before touching widgets.
    """

    def __init__(self, on_state=None):
        self.proc: subprocess.Popen | None = None
        self.port: int | None = None
        self.state = STATE_IDLE
        self.last_error: str | None = None
        self._on_state = on_state or (lambda _s: None)
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ state
    def _set_state(self, state: str, error: str | None = None):
        self.state = state
        if error:
            self.last_error = error
        self._on_state(state)

    # -------------------------------------------------------------- lifecycle
    def start(self) -> None:
        """Launch the server if it is not already running."""
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                return

            # Sweep leftovers first: an orphan holds VRAM and would make this
            # launch fail with an out-of-memory error.
            self.reap_orphans()

            exe = runtime_dir() / (
                "llama-server.exe" if sys.platform == "win32" else "llama-server"
            )
            if not exe.exists():
                self._set_state(STATE_FAILED, f"runtime binary missing: {exe}")
                return

            model = model_path()
            if not model.exists():
                self._set_state(STATE_FAILED, f"model file missing: {model}")
                return

            self.port = _free_port()
            self._set_state(STATE_LOADING)

            creationflags = 0
            preexec_fn = None
            if sys.platform == "win32":
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            else:
                # Put the child in its own process group so we can signal the
                # whole group. Without this, killing the app (or a crashed test)
                # orphans llama-server, which keeps ~5 GB of VRAM allocated and
                # makes the NEXT launch fail with "cudaMalloc failed: out of
                # memory". This is the single most likely field failure.
                preexec_fn = os.setsid

            cmd = [
                str(exe),
                "-m", str(model),
                "--host", "127.0.0.1",
                "--port", str(self.port),
                "-ngl", "99",              # offload every layer to the GPU
                "-c", str(CONTEXT_SIZE),
                "--no-webui",
            ]
            try:
                self.proc = subprocess.Popen(
                    cmd,
                    cwd=str(exe.parent),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    creationflags=creationflags,
                    preexec_fn=preexec_fn,
                )
            except OSError as exc:
                self._set_state(STATE_FAILED, f"could not launch runtime: {exc}")
                return

            # Drain the child's output on a thread so a chatty server can never
            # block on a full pipe, and so we can surface the real error text.
            self._log_tail: list[str] = []
            threading.Thread(
                target=self._drain_output, args=(self.proc,), daemon=True
            ).start()

        threading.Thread(target=self._wait_until_ready, daemon=True).start()

    def _drain_output(self, proc: subprocess.Popen) -> None:
        """Consume the child's stdout so the pipe cannot fill and block it."""
        try:
            for line in proc.stdout:                        # type: ignore[union-attr]
                self._log_tail.append(line.rstrip())
                if len(self._log_tail) > 40:
                    del self._log_tail[:-40]
        except (ValueError, OSError):
            pass

    def _wait_until_ready(self) -> None:
        deadline = time.monotonic() + STARTUP_TIMEOUT
        while time.monotonic() < deadline:
            proc = self.proc
            if proc is None:
                return
            if proc.poll() is not None:
                detail = self._log_tail[-1] if getattr(self, "_log_tail", None) else ""
                # Surface the first real error line, not just the last line.
                first_err = ""
                for ln in getattr(self, "_log_tail", []):
                    if " E " in ln or "error" in ln.lower():
                        first_err = ln
                        break
                self._set_state(
                    STATE_FAILED,
                    f"runtime exited early (code {proc.returncode})"
                    + (f": {first_err or detail}" if (first_err or detail) else ""),
                )
                return
            try:
                r = requests.get(
                    f"http://127.0.0.1:{self.port}/health", timeout=2
                )
                if r.status_code == 200:
                    self._set_state(STATE_READY)
                    return
            except requests.RequestException:
                pass
            time.sleep(0.4)
        self._set_state(STATE_FAILED, "timed out waiting for the model to load")

    def stop(self) -> None:
        """Terminate the server, escalating to kill if it will not exit.

        Signals the whole process group (POSIX) so no child can survive and
        keep holding VRAM.
        """
        with self._lock:
            proc, self.proc = self.proc, None
        if proc is not None and proc.poll() is None:
            self._signal(proc, signal.SIGTERM)
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self._signal(proc, signal.SIGKILL)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
        self._set_state(STATE_IDLE)

    @staticmethod
    def _signal(proc: subprocess.Popen, sig: int) -> None:
        """Send ``sig`` to the child's process group, falling back to the pid."""
        try:
            if sys.platform == "win32":
                proc.terminate() if sig == signal.SIGTERM else proc.kill()
            else:
                os.killpg(os.getpgid(proc.pid), sig)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.terminate() if sig == signal.SIGTERM else proc.kill()
            except OSError:
                pass

    def reap_orphans(self) -> int:
        """Kill any leftover runtime processes from a previous crashed run.

        A hard kill of the app (SIGKILL, power loss, a killed test harness)
        leaves llama-server holding several GB of VRAM, which makes the next
        launch fail with an out-of-memory error. Sweep them before starting.

        Matching is done on the executable path, NOT with ``pgrep -f``: a
        substring match on the process command line also matches any shell whose
        command text happens to contain the name (including the shell that
        launched this app), so a naive sweep kills its own parent.
        """
        if sys.platform == "win32":
            return 0

        target = (runtime_dir() / "llama-server").resolve()
        killed = 0
        try:
            entries = list(Path("/proc").iterdir())
        except OSError:
            return 0

        for entry in entries:
            if not entry.name.isdigit():
                continue
            pid = int(entry.name)
            if pid == os.getpid():
                continue
            try:
                # The kernel records the real executable here; a shell merely
                # mentioning the name in its argv has a different exe link.
                exe = (entry / "exe").resolve()
            except OSError:
                continue
            if exe != target:
                continue
            try:
                os.kill(pid, signal.SIGKILL)
                killed += 1
            except (ProcessLookupError, PermissionError, OSError):
                pass
        return killed

    @property
    def ready(self) -> bool:
        return self.state == STATE_READY and self.proc is not None

    # -------------------------------------------------------------- inference
    def translate(self, text: str, target_code: str, timeout: float = 180.0) -> str:
        """Translate ``text`` into ``target_code``. Blocking; call off the UI thread."""
        if not self.port:
            raise RuntimeError("model runtime is not running")
        payload = {
            "messages": [{"role": "user", "content": build(text, target_code)}],
            "temperature": TEMPERATURE,
            "max_tokens": MAX_TOKENS,
        }
        r = requests.post(
            f"http://127.0.0.1:{self.port}/v1/chat/completions",
            json=payload,
            timeout=timeout,
        )
        r.raise_for_status()
        try:
            out = r.json()["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, ValueError) as exc:
            raise RuntimeError(f"unexpected response from runtime: {exc}") from exc
        if not out:
            raise RuntimeError("the model returned an empty translation")
        return out
