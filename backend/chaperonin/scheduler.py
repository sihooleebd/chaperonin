"""The execution engine / translation layer (proposal §3.3, §6).

``run_pipeline`` receives the frontend's PipelinePayload (graph.js shape),
translates it into a topological run plan, and runs each compute node through
an :class:`ExecutionContext` — host or Docker — streaming the WebSocket event
protocol via ``emit``.

Control flow (spec ``docs/superpowers/specs/2026-05-22-control-flow-design.md``):
START_FOR / END_FOR loops, SAVE / GET variables (scope by topology),
IF gating, COMPARE / SELECT utilities are runtime primitives executed inline
by this module — not @module-decorated tools.

Synchronous on purpose: easy to test, and the server runs it in a worker thread
(the proposal's thread-pool model, §3.1).

``simulate=True`` fakes execution (no Docker): progress + logs + placeholder
outputs, so the whole pipeline is testable before the real images exist.
"""

from __future__ import annotations

import struct
import tempfile
import threading
import time
import traceback
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .context import Cancelled, ExecutionContext, Handle
from .control_nodes import CONTROL_KINDS
from .decorator import REGISTRY
from .scopes import analyze_scopes, ScopeError

_EXT = {
    "Visual.PNG": ".png", "Visual.Web3D": ".wrl",
    "Sequence.FASTA": ".fasta", "Sequence.FASTQ": ".fastq",
    "Structure.PDB": ".pdb", "Structure.mmCIF": ".cif",
}


# ─── RunContext ─────────────────────────────────────────────────────────────

@dataclass
class RunContext:
    """Carries variables and the active scope stack through a pipeline run.

    Variables are keyed by (scope_id, name). Scope ``_root`` is always present.
    Inside a loop, SAVE appends to a list. On pop_scope, that list is promoted
    into the now-current scope under the same name.
    """
    _scopes: list = field(default_factory=lambda: ["_root"])
    _vars: dict = field(default_factory=dict)  # (scope, name) -> value or list

    @property
    def scope(self) -> str:
        return self._scopes[-1]

    def push_scope(self, sid: str) -> None:
        self._scopes.append(sid)

    def save(self, name: str, value) -> None:
        sid = self.scope
        if sid == "_root":
            self._vars[(sid, name)] = value
        else:
            self._vars.setdefault((sid, name), []).append(value)

    def get(self, name):
        for sid in reversed(self._scopes):
            if (sid, name) in self._vars:
                return self._vars[(sid, name)]
        raise KeyError(name)

    def pop_scope(self, sid: str) -> dict:
        if not self._scopes or self._scopes[-1] != sid:
            raise RuntimeError(f"pop_scope({sid!r}) but top is {self._scopes[-1]!r}")
        self._scopes.pop()
        promoted = {}
        for (s, n), v in list(self._vars.items()):
            if s == sid:
                self._vars[(self.scope, n)] = v if isinstance(v, list) else [v]
                promoted[n] = self._vars[(self.scope, n)]
                del self._vars[(s, n)]
        return promoted


# ─── helpers ────────────────────────────────────────────────────────────────

def topo_order(node_ids: list[str], edges: list[dict]) -> list[str]:
    """Kahn's algorithm over the full node set (compute + control + io)."""
    graph = {nid: [] for nid in node_ids}
    indeg = {nid: 0 for nid in node_ids}
    for e in edges:
        s, t = e["source"], e["target"]
        if s in graph and t in indeg:
            graph[s].append(t)
            indeg[t] += 1
    queue = [nid for nid in node_ids if indeg[nid] == 0]
    order = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for nb in graph[nid]:
            indeg[nb] -= 1
            if indeg[nb] == 0:
                queue.append(nb)
    return order


def _solid_png(w=96, h=96, rgb=(40, 90, 160)) -> bytes:
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = (b"\x00" + bytes(rgb) * w) * h
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _write_placeholder(path: Path, dtype: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if dtype == "Visual.PNG":
        path.write_bytes(_solid_png())
    elif dtype == "Visual.Web3D":
        path.write_text("#VRML V2.0 utf8\n# simulated scene\n")
    elif dtype and dtype.startswith("Sequence"):
        path.write_text(">simulated\nMKTAYIAKQR\n")
    elif dtype and dtype.startswith("Structure"):
        path.write_text("REMARK simulated structure\nEND\n")
    else:
        path.write_text("simulated output\n")


def _seed_input_handles(io_nodes: list[dict]) -> dict[str, Handle]:
    handles: dict[str, Handle] = {}
    for io in io_nodes:
        if io.get("type") != "input-node":
            continue
        path = io.get("path")
        handles[f"{io['id']}.value"] = Handle(
            type=io.get("data_type"),
            path=Path(path) if path else None,
            value=io.get("value"),
        )
    return handles


def _bind_instance(spec, params: dict, inputs: dict):
    instance = spec.cls()
    for inp in spec.inputs:
        setattr(instance, inp["id"], inputs.get(inp["id"]))
    for p in spec.params:
        value = params.get(p["id"], p.get("default"))
        setattr(instance, p["id"], Handle(type=p["type"], value=value))
    return instance


def _resolve_input(handles: dict, edges: list, target: str, target_handle: str):
    """Return the upstream Handle for (target, target_handle), or None if no
    edge / source port didn't fire."""
    for e in edges:
        if e["target"] == target and e["target_handle"] == target_handle:
            key = f"{e['source']}.{e['source_handle']}"
            return handles.get(key)
    return None


def _coerce_number(h):
    """Unwrap a Handle to a numeric primitive, or pass through if already one."""
    if h is None:
        return None
    if isinstance(h, Handle):
        return h.value
    return h


def _inject_loop_sync_edges(payload: dict) -> dict:
    """Add synthetic edges from each END_FOR to any GET whose ``name`` matches a
    SAVE inside that loop. Forces topo_order to put those GETs after their
    loops — without these edges, GETs (which have no inputs in their spec) get
    scheduled first and skip with a KeyError."""
    controls = {c["id"]: c for c in payload.get("control_nodes", [])}
    edges = list(payload.get("edges", []))
    if not controls:
        return payload

    all_ids = (
        list(controls)
        + [n["id"] for n in payload.get("nodes", [])]
        + [n["id"] for n in payload.get("io_nodes", [])]
    )
    fwd: dict = {n: [] for n in all_ids}
    rev: dict = {n: [] for n in all_ids}
    for e in edges:
        if e["source"] in fwd and e["target"] in rev:
            fwd[e["source"]].append(e["target"])
            rev[e["target"]].append(e["source"])

    starts = {cid for cid, c in controls.items() if c["kind"] == "START_FOR"}
    end_for_start: dict[str, str] = {}
    for end_id, c in controls.items():
        if c["kind"] != "END_FOR":
            continue
        for e in edges:
            if e["target"] == end_id and e["target_handle"] == "paired_start":
                if e["source"] in starts:
                    end_for_start[e["source"]] = end_id
                    break

    new_edges: list = []
    for start_id, end_id in end_for_start.items():
        # Forward from START (capped at END) + backward from END's body_out
        # source. Mirror analyze_scopes' body computation closely enough that
        # any SAVE that will actually run inside the loop is found here.
        def _walk(start, adj, blocked):
            seen = {start}
            stack = [start]
            while stack:
                n = stack.pop()
                for nb in adj.get(n, ()):
                    if nb in blocked or nb in seen:
                        continue
                    seen.add(nb)
                    stack.append(nb)
            return seen

        reach = _walk(start_id, fwd, blocked={end_id})
        body_out_src = next(
            (e["source"] for e in edges
             if e["target"] == end_id and e["target_handle"] == "body_out"
             and e["source"] in fwd),
            None,
        )
        if body_out_src is not None:
            reach |= _walk(body_out_src, rev, blocked={start_id})
            reach.add(body_out_src)
        # One-hop expansion to catch SAVE side-effects.
        added = True
        while added:
            added = False
            for nid in list(reach):
                for nb in fwd[nid]:
                    if nb in reach or nb == end_id:
                        continue
                    reach.add(nb)
                    added = True

        save_names: set = set()
        for nid in reach:
            c = controls.get(nid)
            if c and c["kind"] == "SAVE":
                nm = (c.get("params") or {}).get("name")
                if nm:
                    save_names.add(nm)

        for get_id, c in controls.items():
            if c["kind"] != "GET":
                continue
            nm = (c.get("params") or {}).get("name")
            if nm not in save_names:
                continue
            # Skip if the GET is itself inside the loop body.
            if get_id in reach:
                continue
            # Already linked?
            if any(e for e in edges
                   if e["source"] == end_id and e["target"] == get_id):
                continue
            new_edges.append({
                "source": end_id, "source_handle": "results",
                "target": get_id, "target_handle": "_sync",
                "data_type": "*",
                "synthetic": True,
            })

    if not new_edges:
        return payload
    aug = dict(payload)
    aug["edges"] = edges + new_edges
    return aug


# ─── control-node executor ──────────────────────────────────────────────────

def _exec_control(ctrl: dict, handles: dict, edges: list, rc: RunContext, emit) -> bool:
    """Execute one control node. Returns False if the node skipped (some
    required input absent), True otherwise.
    """
    cid = ctrl["id"]
    kind = ctrl["kind"]
    params = ctrl.get("params", {})

    def out(port, value):
        handles[f"{cid}.{port}"] = value if isinstance(value, Handle) else Handle(value=value)

    if kind == "SAVE":
        h = _resolve_input(handles, edges, cid, "value")
        if h is None:
            return False
        rc.save(params.get("name", "var"), h)
        out("value", h)
        return True

    if kind == "GET":
        try:
            v = rc.get(params.get("name", "var"))
        except KeyError:
            return False
        out("value", v)
        return True

    if kind == "COMPARE":
        a = _coerce_number(_resolve_input(handles, edges, cid, "a"))
        b = _coerce_number(_resolve_input(handles, edges, cid, "b"))
        if a is None or b is None:
            return False
        op = params.get("op", "lt")
        ok = {"lt": a < b, "le": a <= b, "eq": a == b,
              "ne": a != b, "ge": a >= b, "gt": a > b}[op]
        out("result", bool(ok))
        return True

    if kind == "IF":
        v = _resolve_input(handles, edges, cid, "value")
        cond = _resolve_input(handles, edges, cid, "condition")
        if v is None or cond is None:
            return False
        truthy = bool(cond.value) if isinstance(cond, Handle) else bool(cond)
        if truthy:
            out("if_true", v)
        else:
            out("if_false", v)
        return True

    if kind == "SELECT":
        items_h = _resolve_input(handles, edges, cid, "from")
        scores_h = _resolve_input(handles, edges, cid, "by")
        if items_h is None or scores_h is None:
            return False
        items = items_h.value if isinstance(items_h, Handle) and isinstance(items_h.value, list) else []
        scores_raw = scores_h.value if isinstance(scores_h, Handle) and isinstance(scores_h.value, list) else []
        scores = [_coerce_number(s) for s in scores_raw]
        if len(items) != len(scores):
            raise ValueError(
                f"SELECT {cid}: from={len(items)} and by={len(scores)} differ in length"
            )
        if not items:
            raise ValueError(f"SELECT {cid}: from list is empty")
        mode = params.get("mode", "min")
        if mode == "min":
            idx = min(range(len(scores)), key=lambda i: scores[i])
        elif mode == "max":
            idx = max(range(len(scores)), key=lambda i: scores[i])
        elif mode == "first":
            idx = 0
        elif mode == "last":
            idx = len(items) - 1
        else:
            raise ValueError(f"SELECT {cid}: unknown mode {mode!r}")
        chosen = items[idx]
        out("value", chosen)
        return True

    # START_FOR / END_FOR are handled by the loop driver, not here.
    return True


# ─── compute-node executor (extracted from the old run_pipeline body) ───────

def _run_compute_node(node, handles, edges, cancel, workroot, simulate, step_delay, emit):
    nid = node["id"]
    if cancel.is_set():
        emit({"type": "node.cancelled", "nodeId": nid})
        return

    emit({"type": "node.queued", "nodeId": nid})

    spec = REGISTRY.get(node["module_id"])
    if spec is None:
        emit({"type": "pipeline.error", "message": f"unknown module {node['module_id']}"})
        raise RuntimeError(f"unknown module {node['module_id']}")

    if simulate:
        emit({"type": "node.running", "nodeId": nid})
        node_dir = Path(workroot) / nid
        emit({"type": "node.log", "nodeId": nid,
              "line": f"[simulate] {spec.label} ({spec.container or 'host'})"})
        steps = 8
        cancelled = False
        for s in range(steps + 1):
            if cancel.is_set():
                emit({"type": "node.cancelled", "nodeId": nid})
                cancelled = True
                break
            emit({"type": "node.progress", "nodeId": nid, "current": s, "total": steps})
            if step_delay:
                time.sleep(step_delay)
        if cancelled:
            return
        outputs = {}
        for outdef in spec.outputs:
            p = node_dir / f"{outdef['id']}{_EXT.get(outdef['type'], '.dat')}"
            _write_placeholder(p, outdef["type"])
            handles[f"{nid}.{outdef['id']}"] = Handle(type=outdef["type"], path=p)
            outputs[outdef["id"]] = str(p)
        emit({"type": "node.done", "nodeId": nid, "outputs": outputs})
        return

    inputs: dict = {}
    for inp in spec.inputs:
        edge = next((e for e in edges
                     if e["target"] == nid and e["target_handle"] == inp["id"]), None)
        if edge:
            inputs[inp["id"]] = handles.get(f"{edge['source']}.{edge['source_handle']}")

    emit({"type": "node.running", "nodeId": nid})

    mounts = [(Path(workroot), "rw")]
    for h in inputs.values():
        if h is not None and getattr(h, "path", None) is not None:
            parent = Path(h.path).resolve().parent
            if (parent, "ro") not in mounts and not str(parent).startswith(str(workroot)):
                mounts.append((parent, "ro"))

    ctx = ExecutionContext(
        nid, Path(workroot) / nid, emit,
        container=spec.container, cancel=cancel,
        gpu=spec.resources.get("gpu", 0), mounts=mounts,
        entrypoint=spec.entrypoint, docker_args=spec.docker_args,
    )
    instance = _bind_instance(spec, node.get("params", {}), inputs)

    try:
        instance.execute(ctx)
    except Cancelled:
        emit({"type": "node.cancelled", "nodeId": nid})
        return

    outputs = {}
    for outdef in spec.outputs:
        h = ctx.published.get(outdef["id"])
        if h is None:
            continue
        handles[f"{nid}.{outdef['id']}"] = h
        if h.path is not None:
            outputs[outdef["id"]] = str(h.path)
        elif h.value is not None:
            outputs[outdef["id"]] = h.value
    emit({"type": "node.done", "nodeId": nid, "outputs": outputs})


# ─── main entry point ──────────────────────────────────────────────────────

def run_pipeline(
    payload: dict,
    emit: Callable[[dict], None],
    *,
    cancel: threading.Event | None = None,
    workroot: str | None = None,
    simulate: bool = False,
    step_delay: float = 0.1,
) -> None:
    cancel = cancel or threading.Event()
    workroot = workroot or tempfile.mkdtemp(prefix="chaperonin_")

    payload = _inject_loop_sync_edges(payload)

    compute = {n["id"]: n for n in payload.get("nodes", [])}
    controls = {c["id"]: c for c in payload.get("control_nodes", [])}
    io_nodes = payload.get("io_nodes", [])
    edges = payload.get("edges", [])

    try:
        scopes = analyze_scopes(payload)
    except ScopeError as exc:
        emit({"type": "pipeline.error", "message": f"scope error: {exc}"})
        return

    rc = RunContext()
    handles = _seed_input_handles(io_nodes)

    all_ids = list(compute) + list(controls) + [io["id"] for io in io_nodes]
    full_order = topo_order(all_ids, edges)

    emit({"type": "pipeline.start", "total": len(compute) + len(controls)})

    def run_one(nid):
        """Execute a single node (compute or control) at the current scope."""
        if nid not in compute and nid not in controls:
            return  # io-node — already seeded into handles
        if cancel.is_set():
            emit({"type": "node.cancelled", "nodeId": nid})
            return

        if nid in controls:
            ctrl = controls[nid]
            kind = ctrl["kind"]
            if kind in ("START_FOR", "END_FOR"):
                return  # driven by run_loop
            emit({"type": "node.running", "nodeId": nid})
            try:
                ok = _exec_control(ctrl, handles, edges, rc, emit)
            except Exception as exc:
                emit({"type": "node.failed", "nodeId": nid, "error": str(exc),
                      "traceback": traceback.format_exc()})
                raise
            if ok:
                # Surface any file-bearing outputs so downstream UI (Visualizer)
                # can fetch served URLs.
                spec = CONTROL_KINDS.get(kind)
                outputs: dict = {}
                if spec:
                    for outdef in spec.outputs:
                        h = handles.get(f"{nid}.{outdef['id']}")
                        if isinstance(h, Handle) and h.path is not None:
                            outputs[outdef["id"]] = str(h.path)
                emit({"type": "node.done", "nodeId": nid, "outputs": outputs})
            else:
                emit({"type": "node.skipped", "nodeId": nid})
            return

        _run_compute_node(compute[nid], handles, edges,
                          cancel, workroot, simulate, step_delay, emit)

    def run_loop(start_id):
        info = scopes.loops[start_id]
        count_h = _resolve_input(handles, edges, start_id, "count")
        count_val = _coerce_number(count_h)
        if count_val is None:
            emit({"type": "pipeline.error",
                  "message": f"START_FOR {start_id}: count not connected"})
            raise RuntimeError("count not connected")
        count = int(count_val)
        emit({"type": "node.running", "nodeId": start_id})

        body_out_edge = next(
            (e for e in edges if e["target"] == info.end_id and e["target_handle"] == "body_out"),
            None,
        )
        accumulated = []
        rc.push_scope(start_id)
        try:
            for i in range(count):
                if cancel.is_set():
                    emit({"type": "node.cancelled", "nodeId": start_id})
                    break
                handles[f"{start_id}.iter"] = Handle(value=i, type="Text.Integer")
                handles[f"{start_id}.gate"] = Handle(value=i)
                for body_nid in info.body:
                    run_one(body_nid)
                if body_out_edge is not None:
                    accumulated.append(
                        handles.get(f"{body_out_edge['source']}.{body_out_edge['source_handle']}")
                    )
        finally:
            rc.pop_scope(start_id)
        handles[f"{info.end_id}.results"] = Handle(value=accumulated)
        emit({"type": "node.done", "nodeId": start_id})
        emit({"type": "node.running", "nodeId": info.end_id})
        emit({"type": "node.done", "nodeId": info.end_id,
              "outputs": {"results": f"<list of {len(accumulated)}>"}})

    try:
        for nid in full_order:
            if scopes.scope_of.get(nid) != "_root":
                continue  # body nodes are run by run_loop
            if nid in controls and controls[nid]["kind"] == "START_FOR":
                run_loop(nid)
                continue
            if nid in controls and controls[nid]["kind"] == "END_FOR":
                continue  # handled inside run_loop
            run_one(nid)
        emit({"type": "pipeline.done"})
    except Cancelled:
        emit({"type": "pipeline.done"})
    except Exception as exc:
        emit({"type": "node.failed", "nodeId": locals().get("nid"),
              "error": str(exc), "traceback": traceback.format_exc()})
        emit({"type": "pipeline.error", "message": str(exc)})
        return
