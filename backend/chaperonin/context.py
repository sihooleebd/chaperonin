"""The ExecutionContext — the single seam where a module meets the runtime
(proposal §5.2). Modules never touch the WebSocket, filesystem layout, or
resources directly; everything goes through ``ctx``.

``ctx.run`` executes on the host (no ``container``) or inside a Docker image
(§6.5). Stdout/stderr stream line-by-line through ``ctx.log`` -> ``node.log``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .dockercmd import build_docker_command


class Cancelled(Exception):
    """Raised inside ``ctx.run``/``ctx.checkpoint`` when a cancel was requested."""


@dataclass
class Handle:
    """A typed reference to a value (§4.3). File handles carry ``path``;
    scalar (Text.*) handles carry ``value``."""

    type: str | None = None
    path: Path | None = None
    value: Any = None
    metadata: dict = field(default_factory=dict)


def docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        return subprocess.run(["docker", "info"], capture_output=True).returncode == 0
    except Exception:
        return False


class ExecutionContext:
    def __init__(self, node_id, workdir, emit, *, container=None, cancel=None,
                 gpu=0, mounts=None, entrypoint=None, docker_args=None):
        self.node_id = node_id
        self.workdir = Path(workdir)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self._emit = emit
        self.container = container
        self._cancel = cancel
        self.gpu = gpu
        self.mounts = mounts or []                 # [(Path, "rw"|"ro")]
        self.entrypoint = entrypoint
        self.docker_args = docker_args or []
        self.published: dict[str, Handle] = {}

    # ── input materialization ───────────────────────────────────────────
    def path(self, handle: Handle) -> Path:
        if handle is None or handle.path is None:
            raise ValueError(f"input to {self.node_id} has no file path")
        return Path(handle.path)

    # ── streaming back to the UI ────────────────────────────────────────
    def log(self, line: str, stream: str = "stdout") -> None:
        self._emit({"type": "node.log", "nodeId": self.node_id, "line": line, "stream": stream})

    def progress(self, current: int, total: int, message: str = "") -> None:
        self._emit({"type": "node.progress", "nodeId": self.node_id,
                    "current": current, "total": total, "message": message})

    def metric(self, key: str, value: float) -> None:
        self._emit({"type": "node.metric", "nodeId": self.node_id, "key": key, "value": value})

    # ── output declaration ──────────────────────────────────────────────
    def publish(self, name: str, path=None, *, value=None,
                metadata: dict | None = None) -> None:
        """Register an output. Pass ``path`` for file outputs, ``value`` for
        scalar (Text.*) outputs. Both may be set if needed."""
        h = Handle(metadata=metadata or {})
        if path is not None:
            h.path = Path(path)
        if value is not None:
            h.value = value
        self.published[name] = h

    # ── cancellation / secrets ──────────────────────────────────────────
    def checkpoint(self) -> None:
        if self._cancel is not None and self._cancel.is_set():
            raise Cancelled()

    def env(self, key: str) -> str:
        return os.environ.get(key, "")

    # ── build the command (translation) ─────────────────────────────────
    def build_command(self, argv: list, *, name: str | None = None) -> list[str]:
        argv = [str(a) for a in argv]
        if not self.container:
            return argv
        mounts = self.mounts or [(self.workdir, "rw")]
        return build_docker_command(
            self.container, argv, workdir=self.workdir, mounts=mounts,
            gpu=bool(self.gpu), entrypoint=self.entrypoint, extra_args=self.docker_args,
            name=name,
        )

    # ── subprocess (host or container) ──────────────────────────────────
    def run(self, argv: list, **kwargs) -> None:
        container_name = None
        if self.container:
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in self.node_id)
            container_name = f"chaperonin-{safe}-{uuid.uuid4().hex[:8]}"
            cmd = self.build_command(argv, name=container_name)
            self.log(f"$ {' '.join(cmd)}")  # the exact translation, visible in logs
        else:
            cmd = self.build_command(argv)

        self.checkpoint()
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, cwd=str(self.workdir),
            )
        except FileNotFoundError:
            raise RuntimeError(
                "'docker' not found on PATH — install Docker, or start the server "
                "with CHAPERONIN_SIMULATE=1 to test without it"
            )

        watcher_done = threading.Event()

        def watcher():
            while not watcher_done.wait(0.2):
                if self._cancel is not None and self._cancel.is_set():
                    if container_name:
                        subprocess.run(
                            ["docker", "kill", container_name],
                            capture_output=True, timeout=10,
                        )
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    return
                if proc.poll() is not None:
                    return

        t = threading.Thread(target=watcher, daemon=True)
        t.start()

        try:
            for line in proc.stdout:
                self.log(line.rstrip("\n"))
            proc.wait()
        finally:
            watcher_done.set()
            t.join(timeout=1)

        if self._cancel is not None and self._cancel.is_set():
            raise Cancelled()
        if proc.returncode != 0:
            raise RuntimeError(f"{(argv[0] if argv else cmd[0])} exited with code {proc.returncode}")
