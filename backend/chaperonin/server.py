"""Stdlib-only asyncio server: the orchestrator's user-facing process (§3.2).

  GET  /api/modules            -> introspected REGISTRY (for the palette)
  POST /api/upload?name=FILE   -> save raw request body, return {path}
  GET  /api/outputs/<relpath>  -> serve a produced file (e.g. a PyMOL PNG)
  WS   /ws                     -> {type:"run"|"cancel"} in; event stream out

Speaks the exact protocol the frontend's backend.js expects. Module execution
runs in a worker thread (§3.1); events are bridged back to the event loop.

CHAPERONIN_SIMULATE=1 fakes execution (no Docker) for temporary testing.
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import threading
import uuid
from pathlib import Path

from .introspect import registry_to_json
from .registry import discover
from .scheduler import run_pipeline
from .ws_protocol import accept_key, decode_frames, encode_text_frame

SIMULATE = os.environ.get("CHAPERONIN_SIMULATE", "").lower() in ("1", "true", "yes")

ROOT = Path.home() / ".chaperonin"
UPLOAD_DIR = ROOT / "uploads"
RUNS_DIR = ROOT / "runs"

_FRONTEND_DIST_ENV = os.environ.get("CHAPERONIN_FRONTEND_DIST", "").strip()
FRONTEND_DIST = Path(_FRONTEND_DIST_ENV).resolve() if _FRONTEND_DIST_ENV else None


def _http_response(status: str, body: bytes, content_type: str) -> bytes:
    headers = (
        f"HTTP/1.1 {status}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: *\r\n"
        "Connection: close\r\n\r\n"
    ).encode()
    return headers + body


def _json_response(obj) -> bytes:
    return _http_response("200 OK", json.dumps(obj).encode(), "application/json")


def _outputs_to_urls(event: dict) -> dict:
    if event.get("type") != "node.done":
        return event
    urls = {}
    for handle, path in (event.get("outputs") or {}).items():
        try:
            rel = Path(path).resolve().relative_to(RUNS_DIR.resolve())
            urls[handle] = f"/api/outputs/{rel.as_posix()}"
        except (ValueError, TypeError):
            urls[handle] = str(path)
    return {**event, "outputs": urls}


async def _read_request(reader):
    raw = b""
    while b"\r\n\r\n" not in raw:
        chunk = await reader.read(4096)
        if not chunk:
            break
        raw += chunk
        if len(raw) > 1 << 20:
            break
    head, _, _ = raw.partition(b"\r\n\r\n")
    rest = raw.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in raw else b""
    lines = head.decode("latin1").split("\r\n")
    method, path, *_ = (lines[0].split(" ") + ["", ""])[:3]
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return method, path, headers, rest


async def handle(reader, writer):
    method, path, headers, leftover = await _read_request(reader)

    if headers.get("upgrade", "").lower() == "websocket" and path.startswith("/ws"):
        await _handle_ws(reader, writer, headers, leftover)
        return

    try:
        if method == "OPTIONS":
            writer.write(_http_response("204 No Content", b"", "text/plain"))
        elif path.startswith("/api/modules"):
            writer.write(_json_response(registry_to_json()))
        elif path.startswith("/api/host_info"):
            writer.write(_json_response({
                "gpu": os.environ.get("CHAPERONIN_GPU_AVAILABLE", "").lower() in ("1", "true", "yes"),
            }))
        elif path.startswith("/api/upload") and method == "POST":
            writer.write(await _handle_upload(reader, path, headers, leftover))
        elif path.startswith("/api/outputs/"):
            writer.write(_serve_output(path))
        elif method == "GET" and FRONTEND_DIST is not None:
            writer.write(_serve_frontend(path))
        else:
            writer.write(_http_response("404 Not Found", b"not found", "text/plain"))
        await writer.drain()
    finally:
        writer.close()


async def _handle_upload(reader, path, headers, leftover) -> bytes:
    from urllib.parse import urlparse, parse_qs

    name = parse_qs(urlparse(path).query).get("name", ["upload.dat"])[0]
    name = Path(name).name
    length = int(headers.get("content-length", "0"))
    body = bytearray(leftover)
    while len(body) < length:
        chunk = await reader.read(length - len(body))
        if not chunk:
            break
        body += chunk
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / f"{uuid.uuid4().hex[:8]}_{name}"
    dest.write_bytes(bytes(body))
    return _json_response({"path": str(dest), "name": name})


def _serve_output(path: str) -> bytes:
    rel = path[len("/api/outputs/"):]
    target = (RUNS_DIR / rel).resolve()
    if not str(target).startswith(str(RUNS_DIR.resolve())) or not target.is_file():
        return _http_response("404 Not Found", b"not found", "text/plain")
    ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return _http_response("200 OK", target.read_bytes(), ctype)


def _serve_frontend(path: str) -> bytes:
    if FRONTEND_DIST is None or not FRONTEND_DIST.is_dir():
        return _http_response("404 Not Found", b"not found", "text/plain")
    rel = path.split("?", 1)[0].lstrip("/") or "index.html"
    target = (FRONTEND_DIST / rel).resolve()
    try:
        target.relative_to(FRONTEND_DIST)
    except ValueError:
        return _http_response("404 Not Found", b"not found", "text/plain")
    if not target.is_file():
        target = FRONTEND_DIST / "index.html"
        if not target.is_file():
            return _http_response("404 Not Found", b"not found", "text/plain")
    ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return _http_response("200 OK", target.read_bytes(), ctype)


async def _handle_ws(reader, writer, headers, leftover):
    writer.write((
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept_key(headers.get('sec-websocket-key', ''))}\r\n\r\n"
    ).encode())
    await writer.drain()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    cancel = {"event": None}
    buf = bytes(leftover)

    def emit(event):  # worker thread -> event loop
        loop.call_soon_threadsafe(queue.put_nowait, event)

    async def drain_to_socket():
        while True:
            event = await queue.get()
            writer.write(encode_text_frame(json.dumps(_outputs_to_urls(event))))
            await writer.drain()

    drainer = asyncio.create_task(drain_to_socket())

    def start_run(pipeline):
        ev = threading.Event()
        cancel["event"] = ev
        run_dir = RUNS_DIR / uuid.uuid4().hex[:12]
        threading.Thread(
            target=run_pipeline, args=(pipeline, emit),
            kwargs={"cancel": ev, "workroot": str(run_dir), "simulate": SIMULATE},
            daemon=True,
        ).start()

    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            buf += chunk
            messages, buf = decode_frames(buf)
            for kind, text in messages:
                if kind == "close":
                    return
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "run":
                    start_run(msg.get("pipeline", {}))
                elif msg.get("type") == "cancel" and cancel["event"]:
                    cancel["event"].set()
    finally:
        drainer.cancel()
        writer.close()


async def main(host="0.0.0.0", port=8000):
    discover("modules")
    print(f"[chaperonin] {len(registry_to_json()['modules'])} modules discovered"
          + ("  [SIMULATE MODE — no Docker]" if SIMULATE else "")
          + (f"  [serving frontend from {FRONTEND_DIST}]" if FRONTEND_DIST else ""))
    server = await asyncio.start_server(handle, host, port)
    print(f"[chaperonin] listening on ws://{host}:{port}/ws  (http on /api)")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
