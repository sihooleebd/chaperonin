# Control-Flow Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new node types to chaperonin's canvas (START_FOR / END_FOR / SAVE / GET / IF / COMPARE / SELECT — technically seven node *types* delivered by the same effort) so users can express the "render the worst pLDDT of 100 designs" class of workflow.

**Architecture:** Backend extends the existing DAG scheduler with (a) a pre-execution scope-analysis pass that identifies loop bodies, (b) a `RunContext` that carries variables keyed by `(scope_id, var_name)`, and (c) execution branches for each control primitive. Frontend adds five ReactFlow node components, palette entries in a new `control`/`variable` category, DSL gen/parse for the new keywords, and validation rules. No new external dependencies. Spec: `docs/superpowers/specs/2026-05-22-control-flow-design.md`.

**Tech Stack:** Python 3.12 stdlib (backend); React 18 + ReactFlow 11 + Vite 5 (frontend). Backend tests: `unittest`. Frontend tests: none currently configured — verification is via the existing `tests/smoke_server.py`-style HTTP+WS drivers plus manual browser checks against the running container.

---

## File map

### Backend (Python, stdlib-only)

**Create:**
- `backend/chaperonin/control_nodes.py` — `CONTROL_KINDS` registry: per-kind spec (inputs/outputs/params). Pure data, no executor logic.
- `backend/chaperonin/scopes.py` — `analyze_scopes(payload)`: pre-execution pass that maps each compute/control node to its enclosing scope.
- `backend/tests/test_control_nodes.py` — registry shape tests.
- `backend/tests/test_scopes.py` — scope-analysis tests (single loop, empty body, side branch outside body, nested rejected).
- `backend/tests/test_scheduler_control_flow.py` — end-to-end scheduler tests with the new primitives (uses simulate mode + fake modules so no Docker needed).
- `backend/tests/test_types_list_bool.py` — `List.*` / `Text.Bool` compatibility.

**Modify:**
- `backend/chaperonin/types.py` — add `Text.Bool`; add `List` namespace; update `is_compatible` with the elementwise-lift rule.
- `backend/chaperonin/scheduler.py` — large change. New `RunContext` class, loop execution, IF gating, control-node executors, `skipped` status emission.
- `backend/chaperonin/introspect.py` — extend `registry_to_json` output with a `control_nodes` field.
- `backend/chaperonin/server.py` — pass payload's `control_nodes` field through to scheduler unchanged (already passes the whole dict).

### Frontend (React + ReactFlow, JSX, no test framework)

**Create:**
- `frontend/src/components/LoopNode.jsx` — renders START_FOR and END_FOR (kind via prop).
- `frontend/src/components/VariableNode.jsx` — renders SAVE and GET.
- `frontend/src/components/IfNode.jsx`.
- `frontend/src/components/UtilityNode.jsx` — renders COMPARE and SELECT (shape close to ChaperonNode).

**Modify:**
- `frontend/src/data/modules.js` — add `CONTROL_NODES` registry, `CONTROL_CATEGORIES`, extend `TYPE_COLORS` with `Text.Bool` and `List.*`, extend `isCompatible` with the List elementwise rule, extend `INPUT_TYPES`.
- `frontend/src/utils/dsl.js` — generator emits `start_for / end_for / save / get / if / compare / select` lines; parser recognizes them.
- `frontend/src/utils/graph.js` — `serializePipeline` emits a new `control_nodes` array.
- `frontend/src/App.jsx` — `NODE_TYPES` registers the new components; `onDrop` handles control-node drag ids; `INIT_NODES` & `INIT_EDGES` get an "Example: worst of 5" toggle; `validatePipeline` adds the new checks.
- `frontend/src/components/Palette.jsx` — pulls in `CONTROL_NODES` alongside `MODULES` and adds sections for `control`, `variable`, `utility`.
- `frontend/src/styles/app.css` — visuals for `.loop-node`, `.variable-node`, `.if-node`, plus list-typed handle color.

### Mirror to `demo/`

Per `CLAUDE.md`, copy verbatim: any new component file, any modules.js / dsl.js / Palette.jsx / app.css change. Do **not** copy graph.js changes (demo has no graph.js — it routes through simulation.js). Do **not** copy App.jsx backend-connection logic, only the UI/canvas/DSL/validation logic.

---

## Task ordering rationale

Backend bottom-up (types → registry → scopes → context → executors → API exposure), then frontend bottom-up (modules.js → individual nodes → integration → DSL → validation). Each task ends with `git commit` so a failure mid-plan leaves the tree in a clean state. End-to-end smoke at the very end.

---

## Task 1: Add `Text.Bool` to the type system

**Files:**
- Modify: `backend/chaperonin/types.py`
- Test: `backend/tests/test_types_list_bool.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_types_list_bool.py
"""Type-system additions for control flow: Text.Bool and the List.* namespace."""

import unittest

from chaperonin.types import Text, is_compatible


class TestTextBool(unittest.TestCase):
    def test_bool_is_a_type(self):
        self.assertEqual(Text.Bool.name, "Text.Bool")

    def test_bool_is_subtype_of_text(self):
        self.assertTrue(is_compatible("Text.Bool", "Text"))

    def test_bool_not_compatible_with_integer(self):
        self.assertFalse(is_compatible("Text.Bool", "Text.Integer"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m unittest tests.test_types_list_bool -v`
Expected: FAIL with `AttributeError: type object 'Text' has no attribute 'Bool'`.

- [ ] **Step 3: Implement**

Edit `backend/chaperonin/types.py`, inside `class Text:` block, add one line after `Score = DataType("Text.Score")`:

```python
    Bool = DataType("Text.Bool")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python3 -m unittest tests.test_types_list_bool -v`
Expected: PASS for all three test methods.

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/types.py backend/tests/test_types_list_bool.py
git commit -m "feat(types): add Text.Bool type"
```

---

## Task 2: Add `List` namespace with elementwise compatibility

**Files:**
- Modify: `backend/chaperonin/types.py`
- Test: `backend/tests/test_types_list_bool.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/test_types_list_bool.py`:

```python
class TestListNamespace(unittest.TestCase):
    def test_list_pdb_name(self):
        from chaperonin.types import List
        self.assertEqual(List.Structure.PDB.name, "List.Structure.PDB")

    def test_list_pdb_compat_with_self(self):
        self.assertTrue(is_compatible("List.Structure.PDB", "List.Structure.PDB"))

    def test_list_pdb_compat_with_parent_list(self):
        # List.X is compatible with List.Y iff X is compatible with Y.
        self.assertTrue(is_compatible("List.Structure.PDB", "List.Structure"))

    def test_list_not_compat_with_scalar(self):
        self.assertFalse(is_compatible("List.Structure.PDB", "Structure.PDB"))

    def test_scalar_not_compat_with_list(self):
        self.assertFalse(is_compatible("Structure.PDB", "List.Structure.PDB"))

    def test_list_float_compat_with_list_number_union(self):
        self.assertTrue(is_compatible("List.Text.Float", "List.Text.Float | List.Text.Integer"))
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python3 -m unittest tests.test_types_list_bool.TestListNamespace -v`
Expected: FAIL — `List` not importable.

- [ ] **Step 3: Implement**

Edit `backend/chaperonin/types.py`. Add after the existing `class Text:` block:

```python
class _ListStructure:
    PDB = DataType("List.Structure.PDB")
    mmCIF = DataType("List.Structure.mmCIF")


class _ListSequence:
    FASTA = DataType("List.Sequence.FASTA")
    FASTQ = DataType("List.Sequence.FASTQ")


class _ListText:
    RawString = DataType("List.Text.RawString")
    Integer = DataType("List.Text.Integer")
    Float = DataType("List.Text.Float")
    Score = DataType("List.Text.Score")
    Bool = DataType("List.Text.Bool")


class _ListVisual:
    PNG = DataType("List.Visual.PNG")
    Web3D = DataType("List.Visual.Web3D")


class List:
    Structure = _ListStructure
    Sequence = _ListSequence
    Text = _ListText
    Visual = _ListVisual
```

Then replace the `is_compatible` function body with:

```python
def is_compatible(output_type: str, input_type: str) -> bool:
    """True if a value of ``output_type`` may feed an input declared ``input_type``.

    Rules:
      * exact match
      * subtype → parent (dotted prefix)
      * union (`|` in input)
      * List elementwise lift: ``List.X`` matches ``List.Y`` iff ``X`` matches ``Y``
    """
    if not output_type or not input_type:
        return False
    if output_type == input_type:
        return True
    if "|" in input_type:
        return any(is_compatible(output_type, p.strip()) for p in input_type.split("|"))
    out_is_list = output_type.startswith("List.")
    in_is_list = input_type.startswith("List.")
    if out_is_list != in_is_list:
        return False
    if out_is_list and in_is_list:
        return is_compatible(output_type[5:], input_type[5:])
    if output_type.startswith(input_type + "."):
        return True
    return False
```

- [ ] **Step 4: Run all type tests + the existing suite**

Run: `cd backend && python3 -m unittest discover -s tests -p 'test_*.py' -v 2>&1 | tail -10`
Expected: all tests PASS (new TestListNamespace + existing 37 still green).

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/types.py backend/tests/test_types_list_bool.py
git commit -m "feat(types): add List namespace with elementwise compatibility"
```

---

## Task 3: Create the control-node registry

**Files:**
- Create: `backend/chaperonin/control_nodes.py`
- Test: `backend/tests/test_control_nodes.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_control_nodes.py
"""The control-node registry: pure data describing the 7 control kinds.

These are *runtime primitives*, not @module classes — the scheduler executes
them inline rather than dispatching containers."""

import unittest

from chaperonin.control_nodes import CONTROL_KINDS, ControlSpec


class TestControlRegistry(unittest.TestCase):
    def test_all_seven_kinds_present(self):
        expected = {
            "START_FOR", "END_FOR",
            "SAVE", "GET",
            "IF", "COMPARE", "SELECT",
        }
        self.assertEqual(set(CONTROL_KINDS), expected)

    def test_each_is_a_ControlSpec(self):
        for spec in CONTROL_KINDS.values():
            self.assertIsInstance(spec, ControlSpec)

    def test_start_for_has_count_input_and_iter_output(self):
        s = CONTROL_KINDS["START_FOR"]
        self.assertIn("count", [i["id"] for i in s.inputs])
        self.assertIn("iter", [o["id"] for o in s.outputs])
        self.assertIn("gate", [o["id"] for o in s.outputs])

    def test_end_for_has_paired_start_and_body_out(self):
        s = CONTROL_KINDS["END_FOR"]
        ids = [i["id"] for i in s.inputs]
        self.assertIn("paired_start", ids)
        self.assertIn("body_out", ids)
        self.assertIn("results", [o["id"] for o in s.outputs])

    def test_if_has_value_condition_inputs_and_two_outputs(self):
        s = CONTROL_KINDS["IF"]
        ids = [i["id"] for i in s.inputs]
        self.assertIn("value", ids)
        self.assertIn("condition", ids)
        out_ids = [o["id"] for o in s.outputs]
        self.assertIn("if_true", out_ids)
        self.assertIn("if_false", out_ids)

    def test_compare_op_param(self):
        s = CONTROL_KINDS["COMPARE"]
        op = next(p for p in s.params if p["id"] == "op")
        self.assertEqual(set(op["choices"]), {"lt", "le", "eq", "ne", "ge", "gt"})

    def test_select_mode_param(self):
        s = CONTROL_KINDS["SELECT"]
        mode = next(p for p in s.params if p["id"] == "mode")
        self.assertEqual(set(mode["choices"]), {"min", "max", "first", "last"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python3 -m unittest tests.test_control_nodes -v`
Expected: ImportError on `chaperonin.control_nodes`.

- [ ] **Step 3: Implement**

Create `backend/chaperonin/control_nodes.py`:

```python
"""Control-node registry: the seven runtime primitives the scheduler executes
directly (no container dispatch).

These are deliberately not @module classes — they aren't tools to run, they
are operators that *the orchestrator itself* applies. Keeping them out of
``REGISTRY`` keeps the module decorator's contract clean (every @module dispatches
a container or runs on host).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ControlSpec:
    id: str
    label: str
    category: str
    description: str = ""
    inputs: list = field(default_factory=list)   # [{id, type}]
    params: list = field(default_factory=list)   # [{id, type, default, choices?}]
    outputs: list = field(default_factory=list)  # [{id, type}]


# Wildcard type — propagates whatever's wired in. Resolved at execution time.
_ANY = "*"


CONTROL_KINDS: dict[str, ControlSpec] = {
    "START_FOR": ControlSpec(
        id="START_FOR",
        label="Start For",
        category="control",
        description="Begin a counted loop; everything reachable from gate to the paired END_FOR is the body.",
        inputs=[
            {"id": "count", "type": "Text.Integer"},
        ],
        outputs=[
            {"id": "iter", "type": "Text.Integer"},
            {"id": "gate", "type": _ANY},
        ],
        params=[
            {"id": "loop_label", "type": "Text.RawString", "default": "loop"},
        ],
    ),
    "END_FOR": ControlSpec(
        id="END_FOR",
        label="End For",
        category="control",
        description="Close a loop; results becomes List<body_out>.",
        inputs=[
            {"id": "paired_start", "type": _ANY},
            {"id": "body_out", "type": _ANY},
        ],
        outputs=[
            {"id": "results", "type": _ANY},  # List.<body_out type> set at runtime
        ],
        params=[],
    ),
    "SAVE": ControlSpec(
        id="SAVE",
        label="Save Variable",
        category="variable",
        description="Store value into a named variable; passes value through.",
        inputs=[
            {"id": "value", "type": _ANY},
        ],
        outputs=[
            {"id": "value", "type": _ANY},  # passthrough; type matches input
        ],
        params=[
            {"id": "name", "type": "Text.RawString", "default": "var"},
        ],
    ),
    "GET": ControlSpec(
        id="GET",
        label="Get Variable",
        category="variable",
        description="Read a named variable from the active scope.",
        inputs=[],
        outputs=[
            {"id": "value", "type": _ANY},
        ],
        params=[
            {"id": "name", "type": "Text.RawString", "default": "var"},
        ],
    ),
    "IF": ControlSpec(
        id="IF",
        label="If",
        category="control",
        description="Forward value to if_true or if_false based on condition.",
        inputs=[
            {"id": "value", "type": _ANY},
            {"id": "condition", "type": "Text.Bool"},
        ],
        outputs=[
            {"id": "if_true", "type": _ANY},
            {"id": "if_false", "type": _ANY},
        ],
        params=[],
    ),
    "COMPARE": ControlSpec(
        id="COMPARE",
        label="Compare",
        category="utility",
        description="Compare two numbers; result is Text.Bool.",
        inputs=[
            {"id": "a", "type": "Text.Integer | Text.Float | Text.Score"},
            {"id": "b", "type": "Text.Integer | Text.Float | Text.Score"},
        ],
        outputs=[
            {"id": "result", "type": "Text.Bool"},
        ],
        params=[
            {"id": "op", "type": "Text.RawString", "default": "lt",
             "choices": ["lt", "le", "eq", "ne", "ge", "gt"]},
        ],
    ),
    "SELECT": ControlSpec(
        id="SELECT",
        label="Select",
        category="utility",
        description="Pick one item from a list by parallel-list scoring.",
        inputs=[
            {"id": "from", "type": _ANY},  # must be List.T at runtime
            {"id": "by", "type": "List.Text.Float | List.Text.Integer | List.Text.Score"},
        ],
        outputs=[
            {"id": "value", "type": _ANY},
        ],
        params=[
            {"id": "mode", "type": "Text.RawString", "default": "min",
             "choices": ["min", "max", "first", "last"]},
        ],
    ),
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python3 -m unittest tests.test_control_nodes -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/control_nodes.py backend/tests/test_control_nodes.py
git commit -m "feat(control): add ControlSpec registry for the 7 runtime primitives"
```

---

## Task 4: Scope-analysis pass

**Files:**
- Create: `backend/chaperonin/scopes.py`
- Test: `backend/tests/test_scopes.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scopes.py
"""analyze_scopes: pre-execution pass mapping each node to its enclosing loop.

A node is in a loop's body iff it is reachable from START_FOR.gate AND it can
reach the paired END_FOR. Nested loops are rejected in v1."""

import unittest

from chaperonin.scopes import analyze_scopes, ScopeError


def _payload(nodes=None, control_nodes=None, io_nodes=None, edges=None):
    return {
        "nodes": nodes or [],
        "control_nodes": control_nodes or [],
        "io_nodes": io_nodes or [],
        "edges": edges or [],
        "dsl": "",
    }


class TestAnalyzeScopes(unittest.TestCase):
    def test_no_loops_everything_is_root(self):
        p = _payload(
            nodes=[{"id": "a", "module_id": "X", "inputs": [], "outputs": []}],
            io_nodes=[{"id": "src", "type": "input-node", "data_type": "Structure.PDB"}],
            edges=[{"source": "src", "source_handle": "value",
                    "target": "a", "target_handle": "in"}],
        )
        scopes = analyze_scopes(p)
        self.assertEqual(scopes.scope_of["a"], "_root")
        self.assertEqual(scopes.scope_of["src"], "_root")
        self.assertEqual(scopes.loops, {})

    def test_single_loop_body_membership(self):
        p = _payload(
            control_nodes=[
                {"id": "sf", "kind": "START_FOR", "params": {"loop_label": "l"}},
                {"id": "ef", "kind": "END_FOR", "params": {}},
            ],
            nodes=[
                {"id": "body", "module_id": "X", "inputs": [], "outputs": []},
                {"id": "outside", "module_id": "Y", "inputs": [], "outputs": []},
            ],
            edges=[
                {"source": "sf", "source_handle": "gate",
                 "target": "body", "target_handle": "in"},
                {"source": "body", "source_handle": "out",
                 "target": "ef", "target_handle": "body_out"},
                {"source": "sf", "source_handle": "gate",
                 "target": "ef", "target_handle": "paired_start"},
                {"source": "ef", "source_handle": "results",
                 "target": "outside", "target_handle": "in"},
            ],
        )
        scopes = analyze_scopes(p)
        self.assertEqual(scopes.scope_of["body"], "sf")
        self.assertEqual(scopes.scope_of["outside"], "_root")
        self.assertEqual(scopes.scope_of["sf"], "_root")
        self.assertEqual(scopes.scope_of["ef"], "_root")
        self.assertEqual(scopes.loops["sf"].end_id, "ef")
        self.assertEqual(scopes.loops["sf"].body, ["body"])

    def test_side_branch_not_in_body(self):
        # A node fed from sf.gate but not feeding into ef -- should NOT be body.
        p = _payload(
            control_nodes=[
                {"id": "sf", "kind": "START_FOR", "params": {}},
                {"id": "ef", "kind": "END_FOR", "params": {}},
            ],
            nodes=[
                {"id": "side", "module_id": "X", "inputs": [], "outputs": []},
            ],
            edges=[
                {"source": "sf", "source_handle": "gate",
                 "target": "side", "target_handle": "in"},
                {"source": "sf", "source_handle": "gate",
                 "target": "ef", "target_handle": "paired_start"},
            ],
        )
        scopes = analyze_scopes(p)
        self.assertEqual(scopes.scope_of["side"], "_root")

    def test_end_for_without_paired_start_raises(self):
        p = _payload(
            control_nodes=[
                {"id": "ef", "kind": "END_FOR", "params": {}},
            ],
        )
        with self.assertRaises(ScopeError):
            analyze_scopes(p)

    def test_nested_loop_rejected(self):
        p = _payload(
            control_nodes=[
                {"id": "sf1", "kind": "START_FOR", "params": {}},
                {"id": "ef1", "kind": "END_FOR", "params": {}},
                {"id": "sf2", "kind": "START_FOR", "params": {}},
                {"id": "ef2", "kind": "END_FOR", "params": {}},
            ],
            edges=[
                # outer
                {"source": "sf1", "source_handle": "gate",
                 "target": "sf2", "target_handle": "count"},
                {"source": "sf1", "source_handle": "gate",
                 "target": "ef1", "target_handle": "paired_start"},
                # inner inside outer
                {"source": "sf2", "source_handle": "gate",
                 "target": "ef2", "target_handle": "paired_start"},
                {"source": "ef2", "source_handle": "results",
                 "target": "ef1", "target_handle": "body_out"},
            ],
        )
        with self.assertRaises(ScopeError):
            analyze_scopes(p)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python3 -m unittest tests.test_scopes -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

Create `backend/chaperonin/scopes.py`:

```python
"""Pre-execution scope analysis (spec §"Scope rules").

For each compute or control node, decide which loop's body it belongs to (or
``_root``). A node is in loop ``S``'s body iff it is forward-reachable from
``S`` AND backward-reachable from ``S``'s paired END_FOR. Nested loops are
rejected — a START_FOR may not appear inside another loop's body in v1.

Body membership is what the scheduler uses to know which nodes to execute
N times during a loop.
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


def _adjacency(nodes_ids, edges):
    fwd = {n: [] for n in nodes_ids}
    rev = {n: [] for n in nodes_ids}
    for e in edges:
        s, t = e["source"], e["target"]
        if s in fwd and t in rev:
            fwd[s].append(t)
            rev[t].append(s)
    return fwd, rev


def _reachable(start, adj):
    seen = {start}
    stack = [start]
    while stack:
        n = stack.pop()
        for nb in adj.get(n, ()):
            if nb not in seen:
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

    # Find START_FOR / END_FOR pairs via the paired_start edge.
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

    # Reverse mapping: each start must have exactly one end.
    pair_for_start: dict[str, str] = {}
    for end_id, start_id in pair_for_end.items():
        if start_id in pair_for_start:
            raise ScopeError(
                f"START_FOR {start_id!r} is paired with multiple END_FORs"
            )
        pair_for_start[start_id] = end_id
    for s in starts:
        if s not in pair_for_start:
            raise ScopeError(f"START_FOR {s!r} has no paired END_FOR")

    # Body membership: forward(start) ∩ backward(end), minus the start/end themselves.
    loops: dict[str, LoopInfo] = {}
    for start_id, end_id in pair_for_start.items():
        downstream = _reachable(start_id, fwd) - {start_id}
        upstream_of_end = _reachable(end_id, rev) - {end_id}
        body_set = downstream & upstream_of_end
        body_set.discard(start_id)
        body_set.discard(end_id)
        # Topo order within the body, restricted to body_set.
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

    # Nesting check: no START_FOR may live inside another loop's body.
    for start_id, info in loops.items():
        for other_start, other in loops.items():
            if other_start == start_id:
                continue
            if start_id in other.body:
                raise ScopeError(
                    f"START_FOR {start_id!r} is nested inside {other_start!r}; "
                    "nested loops are out of scope for v1"
                )

    # Scope of each node: innermost loop body it belongs to, else _root.
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
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python3 -m unittest tests.test_scopes -v`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/scopes.py backend/tests/test_scopes.py
git commit -m "feat(scopes): analyze_scopes pre-pass for loop body membership"
```

---

## Task 5: Extend the introspect endpoint with control_nodes

**Files:**
- Modify: `backend/chaperonin/introspect.py`
- Test: `backend/tests/test_introspect.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_introspect.py` (create if it doesn't exist with the necessary imports — current file presence verified at plan-write time).

```python
class TestIntrospectControlNodes(unittest.TestCase):
    def test_control_nodes_present(self):
        from chaperonin.introspect import registry_to_json
        out = registry_to_json()
        self.assertIn("control_nodes", out)
        self.assertIn("START_FOR", out["control_nodes"])
        self.assertIn("END_FOR", out["control_nodes"])
        self.assertIn("IF", out["control_nodes"])

    def test_control_node_has_inputs_outputs_params(self):
        from chaperonin.introspect import registry_to_json
        out = registry_to_json()
        compare = out["control_nodes"]["COMPARE"]
        self.assertIn("inputs", compare)
        self.assertIn("outputs", compare)
        self.assertIn("params", compare)
        self.assertEqual(compare["category"], "utility")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python3 -m unittest tests.test_introspect.TestIntrospectControlNodes -v`
Expected: `KeyError: 'control_nodes'`.

- [ ] **Step 3: Implement**

Replace the body of `backend/chaperonin/introspect.py`:

```python
"""REGISTRY + control-node registry -> JSON for the frontend palette."""

from __future__ import annotations

from .decorator import REGISTRY, ModuleSpec
from .control_nodes import CONTROL_KINDS, ControlSpec


def spec_to_json(spec: ModuleSpec) -> dict:
    return {
        "id": spec.id,
        "label": spec.label,
        "category": spec.category,
        "description": spec.description,
        "resources": spec.resources,
        "retention": spec.retention,
        "inputs": spec.inputs,
        "params": spec.params,
        "outputs": spec.outputs,
    }


def control_to_json(spec: ControlSpec) -> dict:
    return {
        "id": spec.id,
        "label": spec.label,
        "category": spec.category,
        "description": spec.description,
        "inputs": spec.inputs,
        "params": spec.params,
        "outputs": spec.outputs,
    }


def registry_to_json() -> dict:
    return {
        "modules": {name: spec_to_json(spec) for name, spec in REGISTRY.items()},
        "control_nodes": {name: control_to_json(spec) for name, spec in CONTROL_KINDS.items()},
    }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python3 -m unittest discover -s tests -p 'test_*.py' 2>&1 | tail -5`
Expected: all pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/introspect.py backend/tests/test_introspect.py
git commit -m "feat(introspect): expose control_nodes to the frontend palette"
```

---

## Task 6: RunContext for variables + scope tracking

**Files:**
- Modify: `backend/chaperonin/scheduler.py`
- Test: `backend/tests/test_scheduler_control_flow.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduler_control_flow.py
"""Scheduler with control flow: SAVE/GET, loops, IF gating.

Uses simulate=True and a minimal payload — no Docker, no real modules — so
the test runs in milliseconds."""

import unittest

from chaperonin.scheduler import RunContext


class TestRunContext(unittest.TestCase):
    def test_root_scope_save_get(self):
        rc = RunContext()
        rc.save("k", "v")
        self.assertEqual(rc.get("k"), "v")

    def test_loop_scope_accumulates(self):
        rc = RunContext()
        rc.push_scope("sf")
        rc.save("scores", 0.5)
        rc.save("scores", 0.6)
        rc.save("scores", 0.7)
        accumulated = rc.pop_scope("sf")
        # After popping, the accumulated list is visible at _root under the same name.
        self.assertEqual(rc.get("scores"), [0.5, 0.6, 0.7])

    def test_inner_scope_shadows_outer(self):
        rc = RunContext()
        rc.save("x", "outer")
        rc.push_scope("sf")
        self.assertEqual(rc.get("x"), "outer")  # falls back to outer
        rc.save("x", "inner")
        self.assertEqual(rc.get("x"), "inner")
        rc.pop_scope("sf")
        # After popping a loop with one var, that var is a list at _root.
        self.assertEqual(rc.get("x"), ["inner"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python3 -m unittest tests.test_scheduler_control_flow.TestRunContext -v`
Expected: `ImportError: cannot import name 'RunContext'`.

- [ ] **Step 3: Implement**

Add to the top of `backend/chaperonin/scheduler.py` (after existing imports):

```python
from dataclasses import dataclass, field
```

(if not already present — verify; the file already imports `dataclass` indirectly through `.context`, but make the import explicit.)

Then add the `RunContext` class, immediately after the existing imports and constants, before `topo_order`:

```python
@dataclass
class RunContext:
    """Carries variables and the active scope stack through a pipeline run.

    Variables are keyed by (scope_id, name). Scope `_root` is always present.
    Inside a loop, SAVE appends to a list keyed by (loop_start_id, name).
    On pop_scope, that list is promoted into _root under the same name so
    descendants of END_FOR see it.
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
        # Promote anything saved inside the popped scope into the now-current scope
        # under the same name, as a list.
        promoted = {}
        for (s, n), v in list(self._vars.items()):
            if s == sid:
                self._vars[(self.scope, n)] = v if isinstance(v, list) else [v]
                promoted[n] = self._vars[(self.scope, n)]
                del self._vars[(s, n)]
        return promoted
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python3 -m unittest tests.test_scheduler_control_flow.TestRunContext -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/chaperonin/scheduler.py backend/tests/test_scheduler_control_flow.py
git commit -m "feat(scheduler): RunContext for scoped variables"
```

---

## Task 7: Wire control-node execution into the scheduler

**Files:**
- Modify: `backend/chaperonin/scheduler.py` (major: rewrite `run_pipeline` around control nodes)
- Test: `backend/tests/test_scheduler_control_flow.py` (append integration tests)

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/tests/test_scheduler_control_flow.py`:

```python
import json
import threading
from chaperonin.scheduler import run_pipeline


def _io(id_, dtype, value=None):
    out = {"id": id_, "type": "input-node", "var_name": id_, "label": id_,
           "data_type": dtype}
    if value is not None:
        out["value"] = value
    return out


class TestSchedulerControlFlow(unittest.TestCase):
    def _drive(self, payload):
        events = []
        run_pipeline(payload, events.append, simulate=True, step_delay=0)
        return events

    def test_save_get_round_trip_no_loop(self):
        # SAVE 42 with name "x", then GET it, expose via output.
        payload = {
            "nodes": [],
            "control_nodes": [
                {"id": "save1", "kind": "SAVE", "params": {"name": "x"}},
                {"id": "get1", "kind": "GET", "params": {"name": "x"}},
            ],
            "io_nodes": [
                _io("src", "Text.Integer", value=42),
                {"id": "sink", "type": "output-node", "var_name": "sink",
                 "label": "sink", "data_type": "Text.Integer"},
            ],
            "edges": [
                {"source": "src", "source_handle": "value",
                 "target": "save1", "target_handle": "value", "data_type": "Text.Integer"},
                {"source": "get1", "source_handle": "value",
                 "target": "sink", "target_handle": "value", "data_type": "Text.Integer"},
            ],
            "dsl": "",
        }
        evs = self._drive(payload)
        terminals = [e for e in evs if e["type"] in ("pipeline.done", "pipeline.error")]
        self.assertEqual(terminals[-1]["type"], "pipeline.done")

    def test_for_loop_accumulates(self):
        # for_a runs 3 times; body SAVE i; assert _root sees [0,1,2].
        payload = {
            "nodes": [],
            "control_nodes": [
                {"id": "sf", "kind": "START_FOR", "params": {"loop_label": "a"}},
                {"id": "save_i", "kind": "SAVE", "params": {"name": "indices"}},
                {"id": "ef", "kind": "END_FOR", "params": {}},
                {"id": "get_all", "kind": "GET", "params": {"name": "indices"}},
            ],
            "io_nodes": [
                _io("count_in", "Text.Integer", value=3),
                {"id": "sink", "type": "output-node", "var_name": "sink",
                 "label": "sink", "data_type": "List.Text.Integer"},
            ],
            "edges": [
                {"source": "count_in", "source_handle": "value",
                 "target": "sf", "target_handle": "count", "data_type": "Text.Integer"},
                {"source": "sf", "source_handle": "iter",
                 "target": "save_i", "target_handle": "value", "data_type": "Text.Integer"},
                {"source": "sf", "source_handle": "gate",
                 "target": "ef", "target_handle": "paired_start", "data_type": "*"},
                {"source": "save_i", "source_handle": "value",
                 "target": "ef", "target_handle": "body_out", "data_type": "Text.Integer"},
                {"source": "get_all", "source_handle": "value",
                 "target": "sink", "target_handle": "value", "data_type": "List.Text.Integer"},
            ],
            "dsl": "",
        }
        evs = self._drive(payload)
        terminals = [e for e in evs if e["type"] in ("pipeline.done", "pipeline.error")]
        self.assertEqual(terminals[-1]["type"], "pipeline.done", evs)

    def test_compare_then_if_gates_downstream(self):
        # Compare 5 vs 10 with op=lt -> true. IF forwards to if_true branch.
        # Use a dummy SAVE downstream of if_false to verify it's skipped.
        payload = {
            "nodes": [],
            "control_nodes": [
                {"id": "cmp", "kind": "COMPARE", "params": {"op": "lt"}},
                {"id": "ifn", "kind": "IF", "params": {}},
                {"id": "save_t", "kind": "SAVE", "params": {"name": "T"}},
                {"id": "save_f", "kind": "SAVE", "params": {"name": "F"}},
            ],
            "io_nodes": [
                _io("a_in", "Text.Integer", value=5),
                _io("b_in", "Text.Integer", value=10),
                _io("payload_in", "Text.RawString", value="payload"),
            ],
            "edges": [
                {"source": "a_in", "source_handle": "value",
                 "target": "cmp", "target_handle": "a", "data_type": "Text.Integer"},
                {"source": "b_in", "source_handle": "value",
                 "target": "cmp", "target_handle": "b", "data_type": "Text.Integer"},
                {"source": "cmp", "source_handle": "result",
                 "target": "ifn", "target_handle": "condition", "data_type": "Text.Bool"},
                {"source": "payload_in", "source_handle": "value",
                 "target": "ifn", "target_handle": "value", "data_type": "Text.RawString"},
                {"source": "ifn", "source_handle": "if_true",
                 "target": "save_t", "target_handle": "value", "data_type": "Text.RawString"},
                {"source": "ifn", "source_handle": "if_false",
                 "target": "save_f", "target_handle": "value", "data_type": "Text.RawString"},
            ],
            "dsl": "",
        }
        evs = self._drive(payload)
        kinds = [(e["type"], e.get("nodeId")) for e in evs]
        self.assertIn(("node.done", "save_t"), kinds)
        self.assertIn(("node.skipped", "save_f"), kinds)
        self.assertEqual(evs[-1]["type"], "pipeline.done")
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python3 -m unittest tests.test_scheduler_control_flow.TestSchedulerControlFlow -v`
Expected: all 3 FAIL (scheduler doesn't know about control nodes).

- [ ] **Step 3: Implement**

Open `backend/chaperonin/scheduler.py` and replace the body of `run_pipeline` (and add a control-node executor). The full revised file is too long to inline here; the changes by region:

**3a.** Import the new pieces at the top:

```python
from .control_nodes import CONTROL_KINDS
from .scopes import analyze_scopes, ScopeError
```

**3b.** Modify `_seed_input_handles` to also accept io_node `value` for non-PDB types — it already does; no change needed (verify by re-reading lines 84-95).

**3c.** Add a helper `_resolve_input` near the top of the module:

```python
def _resolve_input(handles: dict, edges: list, target: str, target_handle: str):
    """Return the upstream handle for (target, target_handle), or None if the
    source's port didn't fire (IF skipped branches) / source produced nothing."""
    for e in edges:
        if e["target"] == target and e["target_handle"] == target_handle:
            key = f"{e['source']}.{e['source_handle']}"
            return handles.get(key)
    return None
```

**3d.** Add the control-node executor function (place above `run_pipeline`):

```python
def _exec_control(ctrl: dict, handles: dict, edges: list, rc: RunContext, emit) -> bool:
    """Execute one control node. Returns False if the node 'skipped' (some
    required input absent), True otherwise. Side-effects: writes outputs into
    ``handles`` keyed by f"{ctrl['id']}.{port}", calls into ``rc`` for SAVE/GET.
    """
    cid = ctrl["id"]
    kind = ctrl["kind"]
    params = ctrl.get("params", {})

    def out(port, value):
        handles[f"{cid}.{port}"] = Handle(value=value) if not isinstance(value, Handle) else value

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
        a = _resolve_input(handles, edges, cid, "a")
        b = _resolve_input(handles, edges, cid, "b")
        if a is None or b is None:
            return False
        av = a.value if a.path is None else a.path
        bv = b.value if b.path is None else b.path
        op = params.get("op", "lt")
        ok = {
            "lt": av < bv, "le": av <= bv, "eq": av == bv,
            "ne": av != bv, "ge": av >= bv, "gt": av > bv,
        }[op]
        out("result", bool(ok))
        return True

    if kind == "IF":
        v = _resolve_input(handles, edges, cid, "value")
        cond = _resolve_input(handles, edges, cid, "condition")
        if v is None or cond is None:
            return False
        if cond.value:
            out("if_true", v)
        else:
            out("if_false", v)
        return True

    if kind == "SELECT":
        items_h = _resolve_input(handles, edges, cid, "from")
        scores_h = _resolve_input(handles, edges, cid, "by")
        if items_h is None or scores_h is None:
            return False
        items = items_h.value if isinstance(items_h.value, list) else []
        scores = scores_h.value if isinstance(scores_h.value, list) else []
        if len(items) != len(scores):
            raise ValueError(
                f"SELECT {cid}: from={len(items)} and by={len(scores)} differ in length"
            )
        mode = params.get("mode", "min")
        if mode == "min":
            idx = min(range(len(scores)), key=lambda i: scores[i].value if isinstance(scores[i], Handle) else scores[i])
        elif mode == "max":
            idx = max(range(len(scores)), key=lambda i: scores[i].value if isinstance(scores[i], Handle) else scores[i])
        elif mode == "first":
            idx = 0
        elif mode == "last":
            idx = len(items) - 1
        else:
            raise ValueError(f"SELECT {cid}: unknown mode {mode!r}")
        out("value", items[idx])
        return True

    # START_FOR and END_FOR are handled by the loop driver in run_pipeline,
    # not here.
    return True
```

**3e.** Modify `run_pipeline` itself. Replace the existing function. The new shape:

```python
def run_pipeline(
    payload: dict,
    emit,
    *,
    cancel=None,
    workroot=None,
    simulate: bool = False,
    step_delay: float = 0.1,
):
    cancel = cancel or threading.Event()
    workroot = workroot or tempfile.mkdtemp(prefix="chaperonin_")

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

    def run_node(nid):
        """Execute one node (compute OR control) at the current scope."""
        if cancel.is_set():
            emit({"type": "node.cancelled", "nodeId": nid})
            return

        if nid in controls:
            ctrl = controls[nid]
            kind = ctrl["kind"]
            if kind in ("START_FOR", "END_FOR"):
                return  # handled by the loop driver
            emit({"type": "node.running", "nodeId": nid})
            try:
                ok = _exec_control(ctrl, handles, edges, rc, emit)
            except Exception as exc:
                emit({"type": "node.failed", "nodeId": nid, "error": str(exc)})
                emit({"type": "pipeline.error", "message": str(exc)})
                raise
            if ok:
                emit({"type": "node.done", "nodeId": nid})
            else:
                emit({"type": "node.skipped", "nodeId": nid})
            return

        # compute node
        node = compute[nid]
        # ... existing per-node compute logic, including the simulate branch,
        # input resolution, container dispatch, output publication.
        # (No changes to the compute path other than to use _resolve_input
        # where it currently inlines the edge lookup.)
        _run_compute_node(node, handles, edges, cancel, workroot, simulate, step_delay, emit)

    def run_loop(start_id):
        info = scopes.loops[start_id]
        # Resolve count.
        count_h = _resolve_input(handles, edges, start_id, "count")
        if count_h is None or count_h.value is None:
            emit({"type": "pipeline.error", "message": f"START_FOR {start_id}: count not connected"})
            return
        count = int(count_h.value)
        emit({"type": "node.running", "nodeId": start_id})
        rc.push_scope(start_id)
        for i in range(count):
            if cancel.is_set():
                emit({"type": "node.cancelled", "nodeId": start_id})
                break
            handles[f"{start_id}.iter"] = Handle(value=i, type="Text.Integer")
            handles[f"{start_id}.gate"] = Handle(value=i)  # opaque gate; downstream uses what they need
            for body_nid in info.body:
                run_node(body_nid)
        rc.pop_scope(start_id)
        emit({"type": "node.done", "nodeId": start_id})
        # END_FOR: results = the accumulated value of body_out across iterations.
        body_out_acc = []
        for e in edges:
            if e["target"] == info.end_id and e["target_handle"] == "body_out":
                # we have to collect the values that were written into handles each iter
                # but handles[*] holds only the last iter; instead use rc's accumulated form.
                pass
        # Approach: use a per-loop accumulator on handles[f"{end_id}.results"].
        handles[f"{info.end_id}.results"] = Handle(value=_collect_body_out(info, handles, edges))
        emit({"type": "node.running", "nodeId": info.end_id})
        emit({"type": "node.done", "nodeId": info.end_id})

    # Drive the top-level (everything in _root scope, in topo order).
    try:
        skip_until = None
        for nid in full_order:
            if scopes.scope_of.get(nid) != "_root":
                continue  # body nodes handled by run_loop
            if nid in controls and controls[nid]["kind"] == "START_FOR":
                run_loop(nid)
                continue
            if nid in controls and controls[nid]["kind"] == "END_FOR":
                continue  # handled inside run_loop
            run_node(nid)
        emit({"type": "pipeline.done"})
    except Exception as exc:
        emit({"type": "pipeline.error", "message": str(exc)})
```

**3f.** Extract the existing per-compute-node logic (lines ~140-210 of the original `run_pipeline`) into a helper `_run_compute_node(node, handles, edges, cancel, workroot, simulate, step_delay, emit)`. Move the existing body verbatim.

**3g.** Implement `_collect_body_out` — needs an accumulator. Simplest: during loop iteration, after each body-node pass, capture the handle at `(body_out source).source_handle` and append. Refactor accordingly inside `run_loop`:

```python
def run_loop(start_id):
    info = scopes.loops[start_id]
    count_h = _resolve_input(handles, edges, start_id, "count")
    if count_h is None or count_h.value is None:
        emit({"type": "pipeline.error", "message": f"START_FOR {start_id}: count not connected"})
        return
    count = int(count_h.value)
    emit({"type": "node.running", "nodeId": start_id})
    body_out_edge = next((e for e in edges
                          if e["target"] == info.end_id and e["target_handle"] == "body_out"), None)
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
                run_node(body_nid)
            if body_out_edge is not None:
                accumulated.append(handles.get(f"{body_out_edge['source']}.{body_out_edge['source_handle']}"))
    finally:
        rc.pop_scope(start_id)
    handles[f"{info.end_id}.results"] = Handle(value=accumulated)
    emit({"type": "node.done", "nodeId": start_id})
    emit({"type": "node.running", "nodeId": info.end_id})
    emit({"type": "node.done", "nodeId": info.end_id})
```

- [ ] **Step 4: Run the integration tests**

Run: `cd backend && python3 -m unittest tests.test_scheduler_control_flow -v 2>&1 | tail -20`
Expected: 3 control-flow integration tests PASS, all earlier tests still PASS.

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `cd backend && python3 -m unittest discover -s tests -p 'test_*.py' 2>&1 | tail -5`
Expected: 0 failures across all tests (existing + new — should be 40+ tests).

- [ ] **Step 6: Commit**

```bash
git add backend/chaperonin/scheduler.py backend/tests/test_scheduler_control_flow.py
git commit -m "feat(scheduler): execute SAVE/GET/IF/COMPARE/SELECT and FOR loops"
```

---

## Task 8: Frontend — extend `modules.js` with control nodes, list types, isCompatible

**Files:**
- Modify: `frontend/src/data/modules.js`

- [ ] **Step 1: Implement (no unit tests at this layer — verified via browser in Task 14)**

Append to `frontend/src/data/modules.js`, before the closing of the file:

```javascript
// ── Control-flow categories ──
export const CONTROL_CATEGORIES = {
  control:  { label: 'Control',  color: '#f97316' },  // orange
  variable: { label: 'Variable', color: '#a855f7' },  // purple
  utility:  { label: 'Utility',  color: '#94a3b8' },  // gray
};

// ── Control-node registry ──
// Wildcard "*" in input/output type = resolved at runtime by what's wired in.
export const CONTROL_NODES = {
  START_FOR: {
    id: 'START_FOR', label: 'Start For', kind: 'control', category: 'control',
    description: 'Begin a counted loop; body is reachable nodes up to END_FOR',
    inputs:  [{ id: 'count', type: 'Text.Integer' }],
    outputs: [{ id: 'iter', type: 'Text.Integer' }, { id: 'gate', type: '*' }],
    params:  [{ id: 'loop_label', type: 'Text.RawString', default: 'loop' }],
  },
  END_FOR: {
    id: 'END_FOR', label: 'End For', kind: 'control', category: 'control',
    description: 'Close a loop; results = List<body_out>',
    inputs:  [{ id: 'paired_start', type: '*' }, { id: 'body_out', type: '*' }],
    outputs: [{ id: 'results', type: '*' }],
    params:  [],
  },
  SAVE: {
    id: 'SAVE', label: 'Save Variable', kind: 'variable', category: 'variable',
    description: 'Store value into a named variable (passes through)',
    inputs:  [{ id: 'value', type: '*' }],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'name', type: 'Text.RawString', default: 'var' }],
  },
  GET: {
    id: 'GET', label: 'Get Variable', kind: 'variable', category: 'variable',
    description: 'Read a named variable from the active scope',
    inputs:  [],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'name', type: 'Text.RawString', default: 'var' }],
  },
  IF: {
    id: 'IF', label: 'If', kind: 'control', category: 'control',
    description: 'Forward value to if_true or if_false based on condition',
    inputs:  [{ id: 'value', type: '*' }, { id: 'condition', type: 'Text.Bool' }],
    outputs: [{ id: 'if_true', type: '*' }, { id: 'if_false', type: '*' }],
    params:  [],
  },
  COMPARE: {
    id: 'COMPARE', label: 'Compare', kind: 'utility', category: 'utility',
    description: 'Compare two numbers; result is Text.Bool',
    inputs: [
      { id: 'a', type: 'Text.Integer | Text.Float | Text.Score' },
      { id: 'b', type: 'Text.Integer | Text.Float | Text.Score' },
    ],
    outputs: [{ id: 'result', type: 'Text.Bool' }],
    params:  [{ id: 'op', type: 'Text.RawString', default: 'lt',
                choices: ['lt', 'le', 'eq', 'ne', 'ge', 'gt'] }],
  },
  SELECT: {
    id: 'SELECT', label: 'Select', kind: 'utility', category: 'utility',
    description: 'Pick one item from a list by parallel-list scoring',
    inputs: [
      { id: 'from', type: '*' },
      { id: 'by', type: 'List.Text.Float | List.Text.Integer | List.Text.Score' },
    ],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'mode', type: 'Text.RawString', default: 'min',
                choices: ['min', 'max', 'first', 'last'] }],
  },
};
```

Then update `TYPE_COLORS` (right after the existing entries) to add Bool + List:

```javascript
  'Text.Bool':       '#22d3ee',
  'List':            '#0ea5e9',
  'List.Structure':       '#22c55e',
  'List.Structure.PDB':   '#16a34a',
  'List.Structure.mmCIF': '#15803d',
  'List.Sequence.FASTA':  '#d97706',
  'List.Sequence.FASTQ':  '#b45309',
  'List.Text.RawString':  '#64748b',
  'List.Text.Integer':    '#475569',
  'List.Text.Float':      '#334155',
  'List.Text.Score':      '#a3e635',
  'List.Text.Bool':       '#22d3ee',
  'List.Visual.PNG':      '#db2777',
  'List.Visual.Web3D':    '#be185d',
  '*':                    '#94a3b8',
```

Replace the existing `isCompatible` function with the list-aware version:

```javascript
export function isCompatible(outputType, inputType) {
  if (!outputType || !inputType) return false;
  if (outputType === '*' || inputType === '*') return true;
  if (outputType === inputType) return true;
  if (inputType.includes('|')) {
    return inputType.split('|').some((t) => isCompatible(outputType, t.trim()));
  }
  const outIsList = outputType.startsWith('List.');
  const inIsList = inputType.startsWith('List.');
  if (outIsList !== inIsList) return false;
  if (outIsList && inIsList) {
    return isCompatible(outputType.slice(5), inputType.slice(5));
  }
  if (outputType.startsWith(inputType + '.')) return true;
  return false;
}
```

Extend `INPUT_TYPES` (used by the input-node selector) to include the new types:

```javascript
export const INPUT_TYPES = [
  'Structure.PDB',
  'Structure.mmCIF',
  'Sequence.FASTA',
  'Sequence.FASTQ',
  'Text.RawString',
  'Text.Integer',
  'Text.Float',
  'Text.Bool',
];
```

- [ ] **Step 2: Manual sanity (open browser)**

In the running container at http://localhost:8000, hard-refresh. Devtools console — paste:

```javascript
fetch('/api/modules').then(r=>r.json()).then(d=>console.log(Object.keys(d.control_nodes)));
```

Expected: `["START_FOR","END_FOR","SAVE","GET","IF","COMPARE","SELECT"]`

(The frontend isn't using the new exports yet — that's Task 9.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/modules.js
git commit -m "feat(frontend): add CONTROL_NODES registry, List/Bool types, list-aware isCompatible"
```

---

## Task 9: Frontend — LoopNode component (START_FOR + END_FOR)

**Files:**
- Create: `frontend/src/components/LoopNode.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Implement the component**

Create `frontend/src/components/LoopNode.jsx`:

```jsx
import { Handle, Position } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

const KIND_META = {
  START_FOR: {
    label: 'START FOR',
    accent: '#f97316',
    inputs:  [{ id: 'count', type: 'Text.Integer', label: 'count' }],
    outputs: [{ id: 'iter', type: 'Text.Integer', label: 'iter' },
              { id: 'gate', type: '*', label: 'gate' }],
  },
  END_FOR: {
    label: 'END FOR',
    accent: '#f97316',
    inputs:  [{ id: 'paired_start', type: '*', label: 'pair' },
              { id: 'body_out', type: '*', label: 'body' }],
    outputs: [{ id: 'results', type: '*', label: 'results' }],
  },
};

export default function LoopNode({ data, selected }) {
  const meta = KIND_META[data.kind];
  if (!meta) return null;
  const loopLabel = data.params?.loop_label || '';

  return (
    <div className={`loop-node loop-node--${data.kind.toLowerCase()}${selected ? ' loop-node--selected' : ''}`}>
      <div className="loop-node-bracket" style={{ borderColor: meta.accent }} />
      <div className="loop-node-body">
        <div className="loop-node-kind" style={{ color: meta.accent }}>{meta.label}</div>
        {loopLabel && <div className="loop-node-tag">{loopLabel}</div>}
        <div className="loop-node-handles">
          {meta.inputs.map((inp, i) => (
            <Handle
              key={inp.id}
              type="target"
              position={Position.Top}
              id={inp.id}
              title={`${inp.label}: ${inp.type}`}
              style={{
                left: `${((i + 0.5) / meta.inputs.length) * 100}%`,
                background: TYPE_COLORS[inp.type] || meta.accent,
                width: 9, height: 9, border: '2px solid #0d1117',
              }}
            />
          ))}
          {meta.outputs.map((out, i) => (
            <Handle
              key={out.id}
              type="source"
              position={Position.Bottom}
              id={out.id}
              title={`${out.label}: ${out.type}`}
              style={{
                left: `${((i + 0.5) / meta.outputs.length) * 100}%`,
                background: TYPE_COLORS[out.type] || meta.accent,
                width: 9, height: 9, border: '2px solid #0d1117',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `frontend/src/styles/app.css`:

```css
/* ── Control / Loop nodes ───────────────────────────────────── */
.loop-node {
  position: relative;
  min-width: 140px;
  padding: 22px 14px 14px;
  background: var(--surface2);
  border-radius: 7px;
  font-family: var(--ui);
}
.loop-node--selected { box-shadow: 0 0 0 2px var(--accent); }

.loop-node-bracket {
  position: absolute; inset: 0;
  border-radius: 7px;
  border: 1.5px dashed currentColor;
  pointer-events: none;
}
.loop-node--start_for .loop-node-bracket { border-bottom: none; }
.loop-node--end_for   .loop-node-bracket { border-top: none; }

.loop-node-kind {
  font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
  text-transform: uppercase; margin-bottom: 4px;
}
.loop-node-tag {
  font-size: 10px; font-family: var(--mono);
  color: var(--muted); margin-bottom: 8px;
}
```

- [ ] **Step 3: Verify visually (after Task 13 integrates it)**

Defer visual check to Task 13.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LoopNode.jsx frontend/src/styles/app.css
git commit -m "feat(frontend): LoopNode component for START_FOR and END_FOR"
```

---

## Task 10: Frontend — VariableNode component (SAVE + GET)

**Files:**
- Create: `frontend/src/components/VariableNode.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Implement**

```jsx
// frontend/src/components/VariableNode.jsx
import { Handle, Position, useReactFlow } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

const ACCENT = '#a855f7';

export default function VariableNode({ id, data, selected }) {
  const { kind, params = {} } = data;
  const name = params.name || 'var';
  const { setNodes } = useReactFlow();

  const onNameChange = (e) => {
    const v = e.target.value;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, params: { ...n.data.params, name: v } } }
          : n
      )
    );
  };

  const showInput = kind === 'SAVE';
  const handleColor = TYPE_COLORS['*'] || '#94a3b8';

  return (
    <div className={`variable-node${selected ? ' variable-node--selected' : ''}`}>
      <div className="variable-node-kind" style={{ color: ACCENT }}>
        {kind === 'SAVE' ? 'SAVE' : 'GET'}
      </div>
      <input
        className="variable-node-name"
        value={name}
        onChange={onNameChange}
        placeholder="variable name"
      />

      {showInput && (
        <Handle
          type="target"
          position={Position.Top}
          id="value"
          title="value: *"
          style={{ left: '50%', background: handleColor,
                   width: 9, height: 9, border: '2px solid #0d1117' }}
        />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        id="value"
        title="value: *"
        style={{ left: '50%', background: handleColor,
                 width: 9, height: 9, border: '2px solid #0d1117' }}
      />
    </div>
  );
}
```

Append to `frontend/src/styles/app.css`:

```css
/* ── Variable nodes ─────────────────────────────────────────── */
.variable-node {
  min-width: 130px;
  padding: 10px 12px;
  background: var(--surface2);
  border: 1.5px solid #a855f7;
  border-radius: 7px;
  font-family: var(--ui);
  text-align: center;
}
.variable-node--selected { box-shadow: 0 0 0 2px var(--accent); }
.variable-node-kind {
  font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
  margin-bottom: 6px;
}
.variable-node-name {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border, #2a3142);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
  text-align: center;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/VariableNode.jsx frontend/src/styles/app.css
git commit -m "feat(frontend): VariableNode component for SAVE and GET"
```

---

## Task 11: Frontend — IfNode component

**Files:**
- Create: `frontend/src/components/IfNode.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Implement**

```jsx
// frontend/src/components/IfNode.jsx
import { Handle, Position } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

export default function IfNode({ data, selected }) {
  const wild = TYPE_COLORS['*'] || '#94a3b8';
  const boolColor = TYPE_COLORS['Text.Bool'] || '#22d3ee';
  return (
    <div className={`if-node${selected ? ' if-node--selected' : ''}`}>
      <div className="if-node-kind">IF</div>
      <Handle
        type="target" position={Position.Top} id="value"
        title="value: *"
        style={{ left: '30%', background: wild,
                 width: 9, height: 9, border: '2px solid #0d1117' }}
      />
      <Handle
        type="target" position={Position.Top} id="condition"
        title="condition: Text.Bool"
        style={{ left: '70%', background: boolColor,
                 width: 9, height: 9, border: '2px solid #0d1117' }}
      />
      <div className="if-node-ports">
        <span className="if-node-port-label" style={{ color: '#10b981' }}>true</span>
        <span className="if-node-port-label" style={{ color: '#ef4444' }}>false</span>
      </div>
      <Handle
        type="source" position={Position.Bottom} id="if_true"
        title="if_true: *"
        style={{ left: '30%', background: '#10b981',
                 width: 9, height: 9, border: '2px solid #0d1117' }}
      />
      <Handle
        type="source" position={Position.Bottom} id="if_false"
        title="if_false: *"
        style={{ left: '70%', background: '#ef4444',
                 width: 9, height: 9, border: '2px solid #0d1117' }}
      />
    </div>
  );
}
```

Append CSS:

```css
/* ── IF node ────────────────────────────────────────────────── */
.if-node {
  min-width: 110px;
  padding: 16px 14px 22px;
  background: var(--surface2);
  border: 1.5px solid #f97316;
  border-radius: 7px;
  font-family: var(--ui);
  text-align: center;
  position: relative;
}
.if-node--selected { box-shadow: 0 0 0 2px var(--accent); }
.if-node-kind {
  font-size: 11px; font-weight: 700; letter-spacing: 1.5px;
  color: #f97316;
}
.if-node-ports {
  display: flex; justify-content: space-around;
  margin-top: 10px;
}
.if-node-port-label {
  font-size: 8px; font-family: var(--mono); font-weight: 700;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/IfNode.jsx frontend/src/styles/app.css
git commit -m "feat(frontend): IfNode component with true/false output ports"
```

---

## Task 12: Frontend — UtilityNode component (COMPARE + SELECT)

**Files:**
- Create: `frontend/src/components/UtilityNode.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Implement**

```jsx
// frontend/src/components/UtilityNode.jsx
import { Handle, Position, useReactFlow } from 'reactflow';
import { CONTROL_NODES, TYPE_COLORS } from '../data/modules';

const ACCENT = '#94a3b8';

export default function UtilityNode({ id, data, selected }) {
  const spec = CONTROL_NODES[data.kind];
  const { setNodes } = useReactFlow();
  if (!spec) return null;

  const params = data.params || {};
  const onParamChange = (pid, value) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [pid]: value } } }
          : n
      )
    );
  };

  return (
    <div className={`utility-node${selected ? ' utility-node--selected' : ''}`}>
      <div className="utility-node-kind" style={{ color: ACCENT }}>{spec.label}</div>
      {spec.params.map((p) => (
        <label key={p.id} className="utility-node-param">
          <span>{p.id}</span>
          {p.choices ? (
            <select
              value={params[p.id] ?? p.default}
              onChange={(e) => onParamChange(p.id, e.target.value)}
            >
              {p.choices.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input
              value={params[p.id] ?? p.default}
              onChange={(e) => onParamChange(p.id, e.target.value)}
            />
          )}
        </label>
      ))}
      {spec.inputs.map((inp, i) => (
        <Handle
          key={`in-${inp.id}`}
          type="target"
          position={Position.Top}
          id={inp.id}
          title={`${inp.id}: ${inp.type}`}
          style={{
            left: `${((i + 0.5) / spec.inputs.length) * 100}%`,
            background: TYPE_COLORS[inp.type] || ACCENT,
            width: 9, height: 9, border: '2px solid #0d1117',
          }}
        />
      ))}
      {spec.outputs.map((out, i) => (
        <Handle
          key={`out-${out.id}`}
          type="source"
          position={Position.Bottom}
          id={out.id}
          title={`${out.id}: ${out.type}`}
          style={{
            left: `${((i + 0.5) / spec.outputs.length) * 100}%`,
            background: TYPE_COLORS[out.type] || ACCENT,
            width: 9, height: 9, border: '2px solid #0d1117',
          }}
        />
      ))}
    </div>
  );
}
```

Append CSS:

```css
/* ── Utility nodes (COMPARE, SELECT) ─────────────────────────── */
.utility-node {
  min-width: 140px;
  padding: 10px 12px 14px;
  background: var(--surface2);
  border: 1.5px solid var(--border, #2a3142);
  border-radius: 7px;
  font-family: var(--ui);
}
.utility-node--selected { box-shadow: 0 0 0 2px var(--accent); }
.utility-node-kind {
  font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
  margin-bottom: 6px; text-align: center;
}
.utility-node-param {
  display: flex; flex-direction: column; gap: 2px;
  font-size: 9px; font-family: var(--mono); color: var(--muted);
  margin-bottom: 6px;
}
.utility-node-param input,
.utility-node-param select {
  background: var(--surface);
  border: 1px solid var(--border, #2a3142);
  border-radius: 3px;
  padding: 2px 4px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/UtilityNode.jsx frontend/src/styles/app.css
git commit -m "feat(frontend): UtilityNode component for COMPARE and SELECT"
```

---

## Task 13: Wire control nodes into App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Import + register NODE_TYPES**

In `frontend/src/App.jsx`, add imports near the existing component imports:

```jsx
import LoopNode      from './components/LoopNode.jsx';
import VariableNode  from './components/VariableNode.jsx';
import IfNode        from './components/IfNode.jsx';
import UtilityNode   from './components/UtilityNode.jsx';
```

And update `NODE_TYPES`:

```jsx
const NODE_TYPES = {
  chaperonin:    ChaperonNode,
  'input-node':  InputNode,
  'output-node': OutputNode,
  'loop-node':       LoopNode,
  'variable-node':   VariableNode,
  'if-node':         IfNode,
  'utility-node':    UtilityNode,
};
```

Also import `CONTROL_NODES` and `CONTROL_CATEGORIES` near the existing `MODULES` import:

```jsx
import { MODULES, CATEGORIES, TYPE_COLORS, isCompatible, CONTROL_NODES, CONTROL_CATEGORIES } from './data/modules.js';
```

- [ ] **Step 2: Handle control-node drops**

Locate the `onDrop` handler (around line 238). After the `else if (id === 'output-node')` branch and before the final compute-module `else` branch, add:

```jsx
    } else if (id in CONTROL_NODES) {
      const spec = CONTROL_NODES[id];
      const key = id.toLowerCase();
      idCounters.current[key] = (idCounters.current[key] || 0) + 1;
      const varName = `${key}_${idCounters.current[key]}`;
      const defaultParams = Object.fromEntries(
        spec.params.map((p) => [p.id, p.default])
      );
      // Visual node type: route by kind.
      const visualType =
        id === 'START_FOR' || id === 'END_FOR' ? 'loop-node'
        : id === 'SAVE' || id === 'GET'         ? 'variable-node'
        : id === 'IF'                            ? 'if-node'
        :                                          'utility-node';
      newNode = {
        id: varName,
        type: visualType,
        position,
        data: {
          kind: id,
          varName,
          params: defaultParams,
          status: 'idle',
          inputs:  spec.inputs,
          outputs: spec.outputs,
        },
      };
```

- [ ] **Step 3: Update INIT_COUNTERS**

Replace `INIT_COUNTERS` near the top of the file with:

```jsx
const INIT_COUNTERS = {
  rfdiffusion: 0, rosetta_relax: 1, pymol: 1,
  'input-node': 0, 'output-node': 1,
  start_for: 0, end_for: 0,
  save: 0, get: 0,
  if: 0, compare: 0, select: 0,
};
```

- [ ] **Step 4: Restart dev server, manually verify drag-drop**

Run: `cd frontend && npm run dev` (or rebuild + restart container if testing the prod path)
Open http://localhost:5173 (dev) or http://localhost:8000 (container).
Drag each new palette item to the canvas. Verify:
- START_FOR + END_FOR render as orange-dashed bracket shapes
- SAVE + GET as purple nodes with an editable name field
- IF as orange node with green "true" + red "false" output ports
- COMPARE + SELECT as gray nodes with op/mode selectors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): register control-node types and drag-drop handlers"
```

---

## Task 14: Palette shows new categories

**Files:**
- Modify: `frontend/src/components/Palette.jsx`

- [ ] **Step 1: Implement**

Replace the contents of `Palette.jsx` with a version that pulls in CONTROL_NODES alongside MODULES. Keep the existing GPU-blocking logic. The full new file:

```jsx
import { MODULES, CATEGORIES, CONTROL_NODES, CONTROL_CATEGORIES } from '../data/modules';

const MODULE_BY_CATEGORY = Object.values(MODULES).reduce((acc, mod) => {
  (acc[mod.category] ||= []).push(mod);
  return acc;
}, {});

const CONTROL_BY_CATEGORY = Object.values(CONTROL_NODES).reduce((acc, c) => {
  (acc[c.category] ||= []).push(c);
  return acc;
}, {});

const IO_ITEMS = [
  { id: 'input-node',  label: 'Input',  description: 'Pipeline data source', chipLabel: 'IN',  chipColor: '#10b981' },
  { id: 'output-node', label: 'Output', description: 'Pipeline result sink',  chipLabel: 'OUT', chipColor: '#f59e0b' },
];

export default function Palette({ hostGpu = false }) {
  const onDragStart = (e, id) => {
    e.dataTransfer.setData('application/chaperonin', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const isGpuBlocked = (mod) => !hostGpu && (mod.resources?.gpu ?? 0) > 0;

  const renderItem = (item, catDef, blocked = false) => {
    const tip = blocked
      ? `${item.description} — requires NVIDIA GPU (not available on this host)`
      : item.description;
    return (
      <div
        key={item.id}
        className={`palette-item${blocked ? ' palette-item--blocked' : ''}`}
        draggable={!blocked}
        onDragStart={blocked ? undefined : (e) => onDragStart(e, item.id)}
        title={tip}
      >
        <span className="palette-item-chip" style={{ background: catDef.color + '22', color: catDef.color }}>
          {item.id.slice(0, 2)}
        </span>
        <div className="palette-item-text">
          <div className="palette-item-name">
            {item.label}
            {blocked && <span className="palette-item-gpu-tag">GPU</span>}
          </div>
          <div className="palette-item-desc">{item.description}</div>
        </div>
      </div>
    );
  };

  return (
    <aside className="palette">
      <div className="palette-title">Modules</div>

      <div className="palette-section">
        <div className="palette-section-header">
          <span className="palette-section-dot" style={{ background: '#94a3b8' }} />
          Pipeline I/O
        </div>
        {IO_ITEMS.map((item) => (
          <div key={item.id} className="palette-item" draggable onDragStart={(e) => onDragStart(e, item.id)} title={item.description}>
            <span className="palette-item-chip" style={{ background: item.chipColor + '22', color: item.chipColor }}>{item.chipLabel}</span>
            <div className="palette-item-text">
              <div className="palette-item-name">{item.label}</div>
              <div className="palette-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      {Object.entries(MODULE_BY_CATEGORY).map(([cat, mods]) => {
        const catDef = CATEGORIES[cat];
        return (
          <div key={cat} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-dot" style={{ background: catDef.color }} />
              {catDef.label}
            </div>
            {mods.map((mod) => renderItem(mod, catDef, isGpuBlocked(mod)))}
          </div>
        );
      })}

      {Object.entries(CONTROL_BY_CATEGORY).map(([cat, items]) => {
        const catDef = CONTROL_CATEGORIES[cat];
        return (
          <div key={`ctrl-${cat}`} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-dot" style={{ background: catDef.color }} />
              {catDef.label}
            </div>
            {items.map((item) => renderItem(item, catDef, false))}
          </div>
        );
      })}

      <div className="palette-footer">Drag to canvas to add</div>
    </aside>
  );
}
```

- [ ] **Step 2: Visual check**

Reload the page. Confirm three new sections appear in the left palette: Control, Variable, Utility — each draggable.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Palette.jsx
git commit -m "feat(frontend): palette sections for control / variable / utility nodes"
```

---

## Task 15: Serialize control_nodes in the pipeline payload

**Files:**
- Modify: `frontend/src/utils/graph.js`

- [ ] **Step 1: Implement**

Replace the body of `serializePipeline` with a version that splits visual nodes into compute, control, io categories:

```javascript
export function serializePipeline(nodes, edges, dsl) {
  const CONTROL_TYPES = new Set(['loop-node', 'variable-node', 'if-node', 'utility-node']);

  const computeNodes = nodes
    .filter((n) => n.type === 'chaperonin')
    .map((n) => ({
      id:        n.id,
      module_id: n.data.module.id,
      params:    { ...n.data.params },
      inputs:    n.data.module.inputs.map((i) => i.id),
      outputs:   n.data.module.outputs.map((o) => ({ id: o.id, type: o.type })),
    }));

  const controlNodes = nodes
    .filter((n) => CONTROL_TYPES.has(n.type))
    .map((n) => ({
      id:      n.id,
      kind:    n.data.kind,
      params:  { ...(n.data.params || {}) },
      inputs:  n.data.inputs  || [],
      outputs: n.data.outputs || [],
    }));

  const ioNodes = nodes
    .filter((n) => n.type === 'input-node' || n.type === 'output-node')
    .map((n) => ({
      id:        n.id,
      type:      n.type,
      var_name:  n.data.varName,
      label:     n.data.label,
      data_type: n.data.dataType ?? n.data.inferredType ?? null,
      path:      n.data.path  ?? null,
      value:     n.data.value ?? null,
    }));

  const serializedEdges = edges.map((e) => ({
    source:        e.source,
    source_handle: e.sourceHandle,
    target:        e.target,
    target_handle: e.targetHandle,
    data_type:     e.data?.sourceType ?? null,
  }));

  return {
    nodes: computeNodes,
    control_nodes: controlNodes,
    io_nodes: ioNodes,
    edges: serializedEdges,
    dsl,
  };
}
```

- [ ] **Step 2: Verify**

Reload the page; drag a START_FOR + END_FOR + a SAVE; in devtools console paste:

```javascript
// After clicking Run (it'll fail validation — that's OK), check the WS frame.
// Or pop open Network → /ws frames and inspect the run message body.
```

Easier: temporarily add `console.log(JSON.stringify(serializePipeline(nodes, edges, '')))` near `handleRun` in App.jsx, click Run, look at the console — verify `control_nodes` array is populated. Remove the log before committing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/graph.js
git commit -m "feat(frontend): serialize control_nodes in PipelinePayload"
```

---

## Task 16: DSL gen/parse for control nodes

**Files:**
- Modify: `frontend/src/utils/dsl.js`

- [ ] **Step 1: Generator changes**

Extend the per-node loop in `generateDSL` to emit a new line shape per control kind. Insert above the existing `const { module: mod, varName, params = {} } = node.data;` block:

```javascript
    if (node.type === 'loop-node' || node.type === 'variable-node' ||
        node.type === 'if-node'   || node.type === 'utility-node') {
      const { kind, varName, params = {} } = node.data;
      const inEdges = incoming[nodeId] || [];

      const argFor = (handleId) => {
        const edge = inEdges.find((e) => e.targetHandle === handleId);
        if (!edge) return '???';
        const src = nodeMap[edge.source];
        return srcRef(src, edge.sourceHandle);
      };

      if (kind === 'START_FOR') {
        lines.push(`${varName} = start_for(count=${argFor('count')}, label="${params.loop_label || ''}")`);
      } else if (kind === 'END_FOR') {
        lines.push(`${varName} = end_for(paired_start=${argFor('paired_start')}, body_out=${argFor('body_out')})`);
      } else if (kind === 'SAVE') {
        lines.push(`save(${argFor('value')}, name="${params.name || 'var'}")`);
      } else if (kind === 'GET') {
        lines.push(`${varName} = get(name="${params.name || 'var'}")`);
      } else if (kind === 'IF') {
        lines.push(`${varName} = if_(value=${argFor('value')}, condition=${argFor('condition')})`);
      } else if (kind === 'COMPARE') {
        lines.push(`${varName} = compare(${argFor('a')}, ${argFor('b')}, op="${params.op || 'lt'}")`);
      } else if (kind === 'SELECT') {
        lines.push(`${varName} = select(from=${argFor('from')}, by=${argFor('by')}, mode="${params.mode || 'min'}")`);
      }
      continue;
    }
```

- [ ] **Step 2: Parser changes**

Add new regex matchers in `parseDSL` before the existing `modMatch` block:

```javascript
    const startForMatch = line.match(/^(\w+)\s*=\s*start_for\(([^)]*)\)/);
    if (startForMatch) {
      const [, varName, argsStr] = startForMatch;
      const args = parseArgs(argsStr);
      nodes.push({
        id: varName, type: 'loop-node',
        position: posMap[varName] || { x: 220, y: autoY },
        data: { kind: 'START_FOR', varName,
                params: { loop_label: (args.label || '').replace(/^["']|["']$/g, '') },
                status: 'idle' },
      });
      // Treat 'count=X' as an input ref for graph reconstruction
      nodes[nodes.length - 1]._inputRefs = { count: parseRef(args.count) };
      autoY += 140;
      continue;
    }

    const endForMatch = line.match(/^(\w+)\s*=\s*end_for\(([^)]*)\)/);
    if (endForMatch) {
      const [, varName, argsStr] = endForMatch;
      const args = parseArgs(argsStr);
      nodes.push({
        id: varName, type: 'loop-node',
        position: posMap[varName] || { x: 220, y: autoY },
        data: { kind: 'END_FOR', varName, params: {}, status: 'idle' },
      });
      nodes[nodes.length - 1]._inputRefs = {
        paired_start: parseRef(args.paired_start),
        body_out: parseRef(args.body_out),
      };
      autoY += 140;
      continue;
    }

    // ... similar blocks for save, get, if_, compare, select.
    // (Use the same parseRef helper, defined below.)
```

Add the helper at the top of the file (above `generateDSL`):

```javascript
function parseRef(s) {
  if (!s || s === '???') return null;
  const trimmed = s.trim();
  const dot = trimmed.indexOf('.');
  if (dot === -1) return { srcVar: trimmed, srcHandle: 'value' };
  return { srcVar: trimmed.slice(0, dot), srcHandle: trimmed.slice(dot + 1) };
}
```

And modify the edge-building loop at the end of `parseDSL` to handle null refs (skip them).

- [ ] **Step 3: Verify**

In the running app: drag a START_FOR + END_FOR, wire them, observe the DSLPanel emits `start_for(...)` / `end_for(...)` lines. Click "Apply DSL" and verify the canvas regenerates the same shape.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/dsl.js
git commit -m "feat(frontend): DSL gen/parse for control nodes"
```

---

## Task 17: Validation rules

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Implement**

Extend `validatePipeline()`. After the existing module-input checks, add:

```jsx
    // Control-node validation
    const loopNodes = nodes.filter((n) => n.type === 'loop-node');
    const starts = loopNodes.filter((n) => n.data.kind === 'START_FOR');
    const ends   = loopNodes.filter((n) => n.data.kind === 'END_FOR');

    for (const end of ends) {
      const pairedEdge = edges.find((e) => e.target === end.id && e.targetHandle === 'paired_start');
      if (!pairedEdge) {
        missing.push(`${end.data.varName}.paired_start (END_FOR has no paired START_FOR)`);
      } else {
        const src = nodes.find((n) => n.id === pairedEdge.source);
        if (!src || src.type !== 'loop-node' || src.data.kind !== 'START_FOR') {
          typeErrors.push(`${end.data.varName}.paired_start: source is not a START_FOR`);
        }
      }
    }

    for (const ifn of nodes.filter((n) => n.type === 'if-node')) {
      const condEdge = edges.find((e) => e.target === ifn.id && e.targetHandle === 'condition');
      if (!condEdge) {
        missing.push(`${ifn.data.varName}.condition (IF condition unconnected)`);
      }
    }
```

- [ ] **Step 2: Verify**

In the UI: drop an END_FOR with nothing else, click Run — expect a toast: `Cannot run — 1 unconnected input: ... paired_start (END_FOR has no paired START_FOR)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): validation for control-node wiring"
```

---

## Task 18: Mirror UI changes to demo/

**Files:**
- Create: `demo/src/components/LoopNode.jsx` (copy of frontend version, verbatim)
- Create: `demo/src/components/VariableNode.jsx` (verbatim)
- Create: `demo/src/components/IfNode.jsx` (verbatim)
- Create: `demo/src/components/UtilityNode.jsx` (verbatim)
- Modify: `demo/src/data/modules.js` (add CONTROL_NODES/CONTROL_CATEGORIES from frontend; same isCompatible; same TYPE_COLORS additions; same INPUT_TYPES)
- Modify: `demo/src/components/Palette.jsx` (verbatim from frontend)
- Modify: `demo/src/utils/dsl.js` (verbatim from frontend)
- Modify: `demo/src/styles/app.css` (verbatim additions from frontend)
- Modify: `demo/src/App.jsx` (only the canvas/NODE_TYPES/onDrop changes — DO NOT bring in backend.js or graph.js paths)

- [ ] **Step 1: Copy each new component file verbatim**

```bash
cp frontend/src/components/LoopNode.jsx     demo/src/components/LoopNode.jsx
cp frontend/src/components/VariableNode.jsx demo/src/components/VariableNode.jsx
cp frontend/src/components/IfNode.jsx       demo/src/components/IfNode.jsx
cp frontend/src/components/UtilityNode.jsx  demo/src/components/UtilityNode.jsx
```

- [ ] **Step 2: Manually mirror modules.js additions**

Open both files side-by-side and add: CONTROL_NODES, CONTROL_CATEGORIES, the TYPE_COLORS additions, the list-aware isCompatible, INPUT_TYPES with Text.Bool. Demo's modules.js may carry extra mockDuration/mockLogs fields on the biology modules — don't disturb those.

- [ ] **Step 3: Update demo Palette.jsx + dsl.js + App.jsx**

Mirror Palette.jsx and dsl.js verbatim from the frontend versions.

For App.jsx: copy only the NODE_TYPES additions, the onDrop control-node branch, and the INIT_COUNTERS change. Do NOT copy any `backend.connect` / `fetch('/api/host_info')` lines — demo has no backend. Leave demo's simulation.js path untouched.

- [ ] **Step 4: Verify demo still runs**

```bash
cd demo && npm run dev
```

Open http://localhost:5173 (or whatever port demo uses), drag a START_FOR onto the canvas, ensure no console errors. Demo's simulation.js doesn't know about control nodes — so a Run will fake-execute through them ignoring the control logic. That's fine; the demo is reference for visuals.

- [ ] **Step 5: Commit**

```bash
git add demo/
git commit -m "feat(demo): mirror control-flow node UI from frontend"
```

---

## Task 19: End-to-end smoke against the running container

**Files:**
- Create: `/tmp/smoke_control_flow.py` (driver script, not committed)

- [ ] **Step 1: Rebuild + restart the chaperonin container with the new backend**

```bash
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd /Users/benjamin/Documents/Projects/Other/chaperonin
docker build -t chaperonin .
docker rm -f chaperonin
docker run -d --name chaperonin -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /Users/benjamin/.chaperonin:/Users/benjamin/.chaperonin \
  -e HOME=/Users/benjamin \
  -e CHAPERONIN_PYMOL_IMAGE=pegi3s/pymol:latest \
  chaperonin
```

- [ ] **Step 2: Write the smoke driver**

Create `/tmp/smoke_control_flow.py` — based on the existing `/tmp/smoke_demo.py`, but assemble a payload with:

- one input: scaffold PDB (1CRN)
- START_FOR(count=3)
- inside body: ROSETTA_RELAX(structure=START.gate), SAVE(value=structure, name="designs"), SAVE(value=metric, name="scores")
   - Note: real Rosetta doesn't emit a "score" we can route — for the smoke, fabricate a metric by counting atoms or just use iter as a placeholder Text.Integer through a Text.Float coercion (skip; for the smoke purpose, save iter itself to "scores").
- END_FOR
- SELECT(from=GET("designs"), by=GET("scores"), mode="min")
- PYMOL(structure=SELECT.value)
- output

Drive via WebSocket; assert `pipeline.done` and a non-trivial PNG output.

- [ ] **Step 3: Run the smoke**

```bash
python3 /tmp/smoke_control_flow.py
```

Expected: 3 Rosetta child containers spawn (one per iteration), SELECT picks the iteration with the lowest "iter" (= 0), PyMOL renders that design. Total time: ~25-30 seconds.

- [ ] **Step 4: Verify visually**

```bash
curl -sS "http://localhost:8000/api/outputs/<run-id>/pymol_1/render.png" -o /Users/benjamin/Desktop/chaperonin_control_flow_smoke.png
```

Open in Preview.app — should be a green cartoon of crambin (the iter=0 design).

- [ ] **Step 5: Run the full backend unit suite one last time**

```bash
cd backend && python3 -m unittest discover -s tests -p 'test_*.py' 2>&1 | tail -5
```

Expected: 0 failures across the now ~45+ tests.

- [ ] **Step 6: Commit nothing (smoke script is throwaway), but tag the implementation**

```bash
git tag control-flow-v1
```

---

## Spec coverage check

| Spec item | Implementing task |
|---|---|
| `Text.Bool` type | Task 1 |
| `List` namespace + elementwise compat | Task 2 |
| Control-node specs (7 kinds) | Task 3 |
| Scope analysis (forward∩backward, nest rejection) | Task 4 |
| `RunContext` (scoped variables, accumulation) | Task 6 |
| Scheduler control-flow execution | Task 7 |
| `node.skipped` event for IF gating | Task 7 |
| `/api/modules` exposes control_nodes | Task 5 |
| `PipelinePayload.control_nodes` field | Task 15 |
| Frontend CONTROL_NODES registry + isCompatible | Task 8 |
| LoopNode visual | Task 9 |
| VariableNode visual | Task 10 |
| IfNode visual | Task 11 |
| UtilityNode visual (COMPARE/SELECT) | Task 12 |
| App.jsx wiring (NODE_TYPES, onDrop, INIT_COUNTERS) | Task 13 |
| Palette new categories | Task 14 |
| DSL gen+parse | Task 16 |
| Validation rules (paired END_FOR, IF condition) | Task 17 |
| Demo mirror | Task 18 |
| End-to-end smoke | Task 19 |
| Deferred: nested loops | Task 4 (validation rejects them) |
| Deferred: while, boolean combinators, tuple destructuring, aggregations beyond min/max/first/last | Not in plan (out of scope per spec) |
