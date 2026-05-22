"""Pre-execution scope analysis (spec §"Scope rules").

A node is in loop ``S``'s body iff it is forward-reachable from ``S`` AND
backward-reachable from ``S``'s paired END_FOR. Nested loops are rejected in v1.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class ScopeError(ValueError):
    """Raised when scope analysis finds a malformed graph."""


@dataclass
class LoopInfo:
    start_id: str
    end_id: str
    body: list  # node ids in topological order within the body


@dataclass
class Scopes:
    scope_of: dict          # node_id -> scope_id ("_root" or START_FOR node id)
    loops: dict             # start_id -> LoopInfo
    edges_by_target: dict = field(default_factory=dict)
    edges_by_source: dict = field(default_factory=dict)


def _adjacency(node_ids, edges):
    fwd = {n: [] for n in node_ids}
    rev = {n: [] for n in node_ids}
    for e in edges:
        s, t = e["source"], e["target"]
        if s in fwd and t in rev:
            fwd[s].append(t)
            rev[t].append(s)
    return fwd, rev


def _reachable(start, adj, blocked=()):
    """Forward (or reverse) reachability, optionally stopping traversal at
    nodes in ``blocked``. The blocked nodes themselves are not included in the
    result."""
    blocked = set(blocked)
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


def analyze_scopes(payload: dict) -> Scopes:
    compute = {n["id"]: n for n in payload.get("nodes", [])}
    controls = {c["id"]: c for c in payload.get("control_nodes", [])}
    io_nodes = {i["id"]: i for i in payload.get("io_nodes", [])}
    edges = payload.get("edges", [])

    all_ids = list(compute) + list(controls) + list(io_nodes)
    fwd, rev = _adjacency(all_ids, edges)

    starts = [cid for cid, c in controls.items() if c["kind"] == "START_FOR"]
    ends = [cid for cid, c in controls.items() if c["kind"] == "END_FOR"]

    pair_for_end: dict[str, str] = {}
    for end_id in ends:
        sources = [e["source"] for e in edges
                   if e["target"] == end_id and e["target_handle"] == "paired_start"]
        if not sources:
            raise ScopeError(f"END_FOR {end_id!r} has no paired_start edge")
        if len(sources) > 1:
            raise ScopeError(f"END_FOR {end_id!r} has more than one paired_start edge")
        src = sources[0]
        if src not in controls or controls[src]["kind"] != "START_FOR":
            raise ScopeError(
                f"END_FOR {end_id!r} paired_start source {src!r} is not a START_FOR"
            )
        pair_for_end[end_id] = src

    pair_for_start: dict[str, str] = {}
    for end_id, start_id in pair_for_end.items():
        if start_id in pair_for_start:
            raise ScopeError(f"START_FOR {start_id!r} is paired with multiple END_FORs")
        pair_for_start[start_id] = end_id
    for s in starts:
        if s not in pair_for_start:
            raise ScopeError(f"START_FOR {s!r} has no paired END_FOR")

    io_node_ids = set(io_nodes.keys())

    loops: dict[str, LoopInfo] = {}
    for start_id, end_id in pair_for_start.items():
        # Forward-reach from START, capped at END (don't traverse past END).
        downstream = _reachable(start_id, fwd, blocked={end_id}) - {start_id}

        # Backward-reach from END's body_out source — captures the data chain
        # that feeds the loop's results.
        body_out_src = next(
            (e["source"] for e in edges
             if e["target"] == end_id and e["target_handle"] == "body_out"
             and e["source"] in fwd),
            None,
        )
        upstream_of_body_out = set()
        if body_out_src is not None:
            upstream_of_body_out = _reachable(body_out_src, rev, blocked={start_id})
            upstream_of_body_out.add(body_out_src)

        body_set = (downstream | upstream_of_body_out) - {start_id, end_id} - io_node_ids

        # One-hop descendant expansion: pick up side-effect nodes (SAVEs)
        # whose only purpose is to write a variable, capped at END and io-nodes.
        changed = True
        while changed:
            changed = False
            for nid in list(body_set):
                for nb in fwd[nid]:
                    if nb in body_set or nb == start_id or nb == end_id or nb in io_node_ids:
                        continue
                    body_set.add(nb)
                    changed = True

        # Topo-order within body_set.
        body_order: list[str] = []
        indeg = {n: sum(1 for s in rev[n] if s in body_set) for n in body_set}
        ready = [n for n, d in indeg.items() if d == 0]
        while ready:
            n = ready.pop(0)
            body_order.append(n)
            for nb in fwd[n]:
                if nb in indeg:
                    indeg[nb] -= 1
                    if indeg[nb] == 0:
                        ready.append(nb)
        loops[start_id] = LoopInfo(start_id=start_id, end_id=end_id, body=body_order)

    # Reject nested loops.
    for start_id, info in loops.items():
        for other_start, other in loops.items():
            if other_start == start_id:
                continue
            if start_id in other.body:
                raise ScopeError(
                    f"START_FOR {start_id!r} is nested inside {other_start!r}; "
                    "nested loops are out of scope for v1"
                )

    scope_of: dict[str, str] = {nid: "_root" for nid in all_ids}
    for start_id, info in loops.items():
        for nid in info.body:
            scope_of[nid] = start_id

    edges_by_target: dict = {}
    edges_by_source: dict = {}
    for e in edges:
        edges_by_target.setdefault(e["target"], []).append(e)
        edges_by_source.setdefault(e["source"], []).append(e)

    return Scopes(scope_of=scope_of, loops=loops,
                  edges_by_target=edges_by_target, edges_by_source=edges_by_source)
