"""End-to-end smoke against a running server (run separately, not via unittest).

GET /api/modules, POST /api/upload, WS run of a graph, node.done outputs served
as /api/outputs URLs. Works in CHAPERONIN_SIMULATE=1 mode (no Docker)."""

import json
import os
import socket
import struct
import sys
import time
import urllib.request

H, P = "127.0.0.1", 8000
BASE = f"http://{H}:{P}"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return r.status, r.read()


def post(path, body):
    req = urllib.request.Request(BASE + path, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def ws_connect():
    s = socket.create_connection((H, P), timeout=5)
    s.sendall((f"GET /ws HTTP/1.1\r\nHost: {H}\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    assert b"101" in buf
    return s, buf.split(b"\r\n\r\n", 1)[1]


def ws_send(s, obj):
    p = json.dumps(obj).encode()
    m = os.urandom(4)
    h = bytearray([0x81])
    if len(p) < 126:
        h.append(0x80 | len(p))
    else:
        h.append(0x80 | 126); h += struct.pack(">H", len(p))
    s.sendall(bytes(h) + m + bytes(x ^ m[i % 4] for i, x in enumerate(p)))


def main():
    from chaperonin.ws_protocol import decode_frames
    st, body = get("/api/modules")
    mods = json.loads(body)["modules"]
    assert st == 200 and len(mods) == 6, list(mods)
    print(f"  /api/modules -> {sorted(mods)}")

    up = post("/api/upload?name=scaffold.pdb", b"ATOM 1\n")
    print(f"  /api/upload -> {up['path']}")

    pipe = {
        "nodes": [
            {"id": "rfdiffusion_1", "module_id": "RFDIFFUSION", "params": {"length": 100, "cycle": 50},
             "inputs": ["pdb_file", "hotspot"], "outputs": [{"id": "designed_pdb", "type": "Structure.PDB"}]},
            {"id": "pymol_1", "module_id": "PYMOL", "params": {"style": "cartoon"},
             "inputs": ["structure"], "outputs": [{"id": "rendered", "type": "Visual.PNG"},
                                                   {"id": "scene", "type": "Visual.Web3D"}]}],
        "io_nodes": [
            {"id": "scaffold", "type": "input-node", "var_name": "scaffold", "label": "scaffold",
             "data_type": "Structure.PDB", "path": up["path"]},
            {"id": "hot", "type": "input-node", "var_name": "hot", "label": "hotspot",
             "data_type": "Text.RawString", "value": "A50-60"}],
        "edges": [
            {"source": "scaffold", "source_handle": "value", "target": "rfdiffusion_1",
             "target_handle": "pdb_file", "data_type": "Structure.PDB"},
            {"source": "hot", "source_handle": "value", "target": "rfdiffusion_1",
             "target_handle": "hotspot", "data_type": "Text.RawString"},
            {"source": "rfdiffusion_1", "source_handle": "designed_pdb", "target": "pymol_1",
             "target_handle": "structure", "data_type": "Structure.PDB"}],
        "dsl": "",
    }
    s, lo = ws_connect()
    ws_send(s, {"type": "run", "pipeline": pipe})
    buf, evs = lo, []
    s.settimeout(15)
    while True:
        msgs, buf = decode_frames(buf)
        for k, t in msgs:
            if k == "text":
                evs.append(json.loads(t))
        if any(e["type"] in ("pipeline.done", "pipeline.error") for e in evs):
            break
        buf += s.recv(65536)
    types = [e["type"] for e in evs]
    assert types[-1] == "pipeline.done", types
    png = next(e for e in evs if e["type"] == "node.done" and e["nodeId"] == "pymol_1")["outputs"]["rendered"]
    img = get(png)[1]
    assert img[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    print(f"  WS run -> {len(evs)} events, terminal={types[-1]}")
    print(f"  PyMOL PNG {png} -> {len(img)} bytes, valid PNG")
    print("SMOKE PASS")


if __name__ == "__main__":
    for _ in range(40):
        try:
            get("/api/modules"); break
        except Exception:
            time.sleep(0.25)
    else:
        print("server never came up", file=sys.stderr); sys.exit(1)
    main()
