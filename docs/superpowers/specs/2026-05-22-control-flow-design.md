# Control flow blocks: START_FOR / END_FOR, IF, SAVE/GET, COMPARE, SELECT

**Status:** approved
**Date:** 2026-05-22

## Motivation

The current Chaperonin pipeline is a pure typed DAG: every node fires once,
edges carry one value, topology is fixed. This makes the "obvious" biology
workflows easy ("scaffold → fold → render") but blocks the next class of
workflows that users actually want, exemplified by:

> Run RFdiffusion + ESMFold 100 times. Save each design and its pLDDT. After the
> loop, render the design with the *worst* pLDDT.

That single example requires three capabilities the DAG can't express: repeating
a sub-graph N times (`for`), naming intermediate values across iterations
(`save-to-variable`), and selecting one item from the resulting list. A separate
class of workflows ("if confidence > threshold, refine; else, redesign") needs a
fourth (`if`).

## The blocks

Five new node types are added — three the user asked for plus two helpers
needed to make them useful.

| Node | Category | Inputs | Outputs | Param |
|---|---|---|---|---|
| `START_FOR` | control | `count: Text.Integer` | `iter: Text.Integer`, `gate: T` (passthrough of whatever data is wired in to seed the body) | `loop_label` (string, visual only — pairing is by edge, see END_FOR) |
| `END_FOR` | control | `body_out: T`, `paired_start: any` (wire from START_FOR's `gate` — this is what pairs them) | `results: List.T` | — |
| `SAVE` | variable | `value: T` | `value: T` (passthrough) | `name: string` |
| `GET` | variable | — | `value: T` (or `List.T` if reading the accumulated form from outside a loop) | `name: string` |
| `IF` | control | `value: T`, `condition: Text.Bool` | `if_true: T`, `if_false: T` (only one fires per evaluation) | — |
| `COMPARE` | utility | `a: Text.Integer \| Text.Float`, `b: Text.Integer \| Text.Float` | `result: Text.Bool` | `op: lt\|le\|eq\|ne\|ge\|gt` |
| `SELECT` | utility | `from: List.T`, `by: List.Text.Float \| List.Text.Integer` | `value: T` | `mode: min\|max\|first\|last` |

`T` is a type variable — handles are typed by what's wired in. Union input
types use the existing `\|` separator (already supported in `isCompatible`).
`loop_label` on START_FOR is a human-readable string for the bracket-pair
visualization; pairing is exclusively by the `paired_start` edge, never by
matching strings.

## Type system additions

- New `Text.Bool` type, sibling of `Text.Integer` / `Text.Float`. Carried as a
  scalar value (true/false) — no special framing.
- New `List` namespace, hierarchical like the existing types. For every
  existing typed leaf there's a parallel `List.<leaf>` (e.g.
  `List.Structure.PDB`, `List.Text.Float`). The `isCompatible` function gains
  one rule: `List.X` is the elementwise lift of `X`; an output of `List.A` is
  compatible with an input declared `List.B` iff `A` is compatible with `B`.

## Scope rules

The user's stated rule: *a variable is accessible from its declaration and
below*. Mapped to the DAG, that means:

- A `SAVE` node writes a variable visible to any **topological descendant** of
  itself in the same scope.
- Inside a `START_FOR..END_FOR` pair (i.e., body nodes), `SAVE` *accumulates*
  per iteration: each iteration appends. After `END_FOR`, the variable is
  visible to descendants of `END_FOR` as a `List.T`.
- Outside any loop, `SAVE` is a single assignment. `GET` returns the value most
  recently written for that name in the nearest enclosing scope.

The active scope at any node is determined entirely by graph topology, computed
once before execution (see "Scheduler changes" below).

## Execution semantics

### START_FOR / END_FOR

Pairing is **explicit by edge**: the `paired_start` input handle on `END_FOR`
must receive an edge from the `gate` output handle of exactly one `START_FOR`.
This is what binds the two together — there is no name-matching, no node-id
lookup. Validation rejects a graph with unpaired `END_FOR` or with an
`END_FOR` whose `paired_start` source is not a `START_FOR`.

**Body membership** is everything topologically between the start and the end:
the set of nodes that are descendants of `START_FOR` *and* ancestors of
`END_FOR`. Computed by intersecting forward-reachability from start with
reverse-reachability from end. Anything outside that set is in the outer scope
even if visually drawn "inside" the loop.

**Execution**: when the scheduler reaches a `START_FOR` in topo order, it
enters loop mode for that scope:

1. Reads `count` from the input edge or param.
2. For `i in 0..count-1`:
   - Sets `iter = i` (the value of `START_FOR.iter` for this iteration).
   - Runs every body node in topo order, materializing per-iteration output
     handles.
   - Any `SAVE` inside the body appends to the named variable for this scope.
3. After the loop, the `END_FOR.results` output handle is populated with the
   list of body_out values across all iterations.
4. Variables saved inside the body are now reachable to descendants of
   `END_FOR` as `List.T`.

### IF

When the scheduler executes an `IF` node:

- Reads the boolean from `condition`.
- If true, emits to `if_true` and **does not emit** to `if_false`.
- If false, emits to `if_false` and **does not emit** to `if_true`.

A downstream node whose only input is the un-fired branch is marked
`skipped` (new status, distinct from `cancelled` and from `failed`). Downstream
nodes with multiple inputs follow the same union rule that already applies to
optional inputs: if any required input is missing, the node is `skipped`.

`pipeline.done` still fires at the end; the run is considered successful even
if some nodes were `skipped`.

### SAVE / GET

- `SAVE` is a passthrough on its data port. The save side-effect is
  asynchronous to the data flow — the passthrough lets you chain SAVE in the
  middle of a wire without forking edges.
- `GET` has no inputs. At execution time it looks up the variable for its
  `name` param in the active scope (innermost first, walking outward).
- Multiple `SAVE`s with the same name in the same scope: last write wins
  (sequential within a single iteration; or accumulates across iterations
  inside a loop).

### COMPARE / SELECT

Pure functions of their inputs. No side-effects, no scope interaction.

- `COMPARE` reads `a` and `b` as numbers, applies the `op`, emits a `Text.Bool`.
- `SELECT` reads parallel lists `from` and `by`, picks one item according to
  `mode`, emits a scalar of the element type.
- `SELECT` validates that `from` and `by` are the same length at execution
  time; mismatched lengths → `pipeline.error`.

## Component-by-component changes

### Backend

**`backend/chaperonin/scheduler.py`** — the bulk of the work. Currently runs a
single linear topo sweep over compute nodes. After this change:

1. New pre-execution pass `analyze_scopes(payload)` returns:
   - A mapping `node_id → scope_id` where `scope_id` is the START_FOR
     node-id of the innermost containing loop, or the literal string `_root`
     for the outermost scope.
   - A mapping `start_node_id → (end_node_id, body_node_ids)` — pair identity
     uses the START_FOR node's own id; no separate loop_id is materialized.
2. `run_pipeline` is rewritten around a `RunContext` that owns:
   - The `handles` dict (already exists).
   - A new `variables: dict[str, dict[str, Handle | list[Handle]]]`, keyed by
     `(scope_id, var_name)`.
   - The active scope stack.
3. The main loop walks topo order. When it hits a `START_FOR`, it pushes the
   loop's scope, runs the body nodes count times, accumulating per-iteration
   into variables, then pops scope and continues. When it hits an `END_FOR`, it
   simply uses the accumulated results to populate the output.
4. `IF` handling: when an IF node runs, mark which output port fired in
   `RunContext`. Downstream node resolution looks up the source edge's port;
   if the port didn't fire, the input handle is `None` and the node is
   `skipped` if all its required inputs are `None`.

**`backend/chaperonin/types.py`** — `Text.Bool` added to the type registry.
`List` namespace added with the elementwise-compatibility rule in
`is_compatible`.

**`backend/chaperonin/decorator.py`** — no module-side changes; existing
@module API stays. The new nodes are special-cased by the scheduler rather
than registered as @module classes (they are *runtime primitives*, not
container-dispatched tools).

**`backend/chaperonin/introspect.py`** — the `/api/modules` endpoint gains a
parallel `/api/control_nodes` (or extends the existing payload with a
`control_nodes` field) so the frontend palette knows about the new nodes
without them being in `REGISTRY`.

### Frontend

**`frontend/src/data/modules.js`** — new `CONTROL_NODES` registry alongside
`MODULES`, with entries for the five new node types. New category colors:
`control` (orange/amber for loop), `variable` (purple), reuse `utility` (gray).

**`frontend/src/components/`** — new components:
- `LoopNode.jsx` — renders both `START_FOR` and `END_FOR` (the kind is a prop).
  Visually distinct: bracket-shaped, with the `loop_label` param shown on
  both START and END for at-a-glance pairing.
- `VariableNode.jsx` — renders both `SAVE` and `GET`. A name field is the
  prominent visual.
- `IfNode.jsx` — diamond/branch shape, two output handles colored true/false.
- `CompareNode.jsx`, `SelectNode.jsx` — module-shaped utility nodes; reuse
  most of `ChaperonNode` styling.

**`frontend/src/data/modules.js → isCompatible`** — gains the `List.X`
elementwise lift rule.

**`frontend/src/utils/dsl.js`** — generator/parser learns the new keywords:
`start_for`, `end_for`, `save`, `get`, `if`, `compare`, `select`. The
generator emits indented bodies between `start_for` and `end_for` for
readability; the parser ignores indentation (it's a topology hint, not
semantic).

**`frontend/src/utils/graph.js → serializePipeline`** — control nodes get the
same shape as compute nodes (id, kind, params, inputs, outputs) but go into a
new `control_nodes` array in the payload, parallel to `nodes` and `io_nodes`.

**`frontend/src/App.jsx → validatePipeline`** — adds the three new checks:

1. Every `END_FOR` has its `paired_start` connected to a `START_FOR`.
2. Every `IF`'s `condition` input is connected.
3. (Soft warning) A `SAVE` with no matching `GET` reading the same name is
   dead code.

### Wire-format payload

`PipelinePayload` gains one new top-level field:

```jsonc
{
  "nodes": [...],          // compute nodes (unchanged)
  "control_nodes": [...],  // NEW — start_for/end_for/save/get/if/compare/select
  "io_nodes": [...],       // unchanged
  "edges": [...],          // unchanged — edges go to/from control nodes
                           // the same way they go to/from compute nodes
  "dsl": "..."
}
```

## What's deliberately out of scope (defer until asked)

- **Nested loops.** The scope-stack design supports them, but the validation
  UX (visualizing which body a node belongs to when two loops overlap) is
  thorny enough to defer. The first version rejects nested loops in
  validation.
- **`while` loops.** `for + count` covers the stated use case. Add later
  if a real workflow needs it.
- **Boolean combinators** (`and` / `or` / `not`). Chain COMPAREs through IF if
  needed; revisit if it gets painful.
- **Visual tuple destructuring** (`folded, plddt = ESMFOLD(...)`). The DSL
  shows it that way for readability, but on the canvas these are still two
  separate output handles on the same node.
- **Aggregations beyond `min/max/first/last`** (mean, median, sort, top-k).
  Easy to add later as new SELECT modes; not needed for the stated workflow.

## Validation pre-flight (new errors the frontend can show)

- `END_FOR has no paired START_FOR` — UX: red border on the END_FOR.
- `START_FOR has no paired END_FOR` — same.
- `Nested loop detected (out of scope for v1)`.
- `IF condition is not connected`.
- `SELECT inputs not the same length at runtime` (this one is a runtime
  error, not a pre-flight one).

## Example: "render the worst of 100 designs"

```
scaffold_in = input(Structure.PDB, label="scaffold")

for_a = start_for(count=100)
  designed   = RFDIFFUSION(input=for_a.gate)
  folded     = ESMFOLD(designed)
  plddt      = folded.plddt           # imagined output handle, illustration only
  save(plddt,  name="scores")
  save(folded, name="designs")
end_for(for_a)

worst = SELECT(from=get("designs"), by=get("scores"), mode=min)
PYMOL(structure=worst, style="cartoon") → render_out
```

The render_out PNG is the structure with the lowest pLDDT across all 100 runs.

## Testing plan (sketch — full plan in implementation phase)

- Unit: `analyze_scopes()` over hand-built graphs (empty loop, single-node
  body, two parallel branches, nested → expect rejection).
- Unit: `RunContext.variables` accumulation across iterations.
- Unit: IF gating — verify `skipped` status propagates.
- Smoke: end-to-end the "worst of 5" workflow (count=5 to keep CI fast)
  with the existing Rosetta + PyMOL images; assert the rendered PNG is the
  one corresponding to the minimum saved score.
