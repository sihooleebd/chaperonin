# Chaperonin
Made by Sihoo Lee and Hangyeol Lim 
**A Modular Workflow Engine for Computational Biology**

*Project proposal — v0.3 · working title*

> *Chaperonins (GroEL, HSP60) are a class of proteins whose function is to assist other proteins in reaching their correct folded state. The metaphor — a system whose job is to help other tools reach their functional output — is the project's mission statement.*

---

## 1. Executive Summary

Computational biology depends on a sprawl of heterogeneous command-line tools — RFdiffusion, AlphaFold, PyMOL, RoseTTAFold, and dozens more — that disagree on file formats, runtime environments, and parameter conventions. Connecting them today means writing throwaway shell glue. That kills reproducibility, blocks experimental scaling, and gates bench scientists out of the iteration loop entirely.

**Chaperonin** is a typed, modular workflow engine that lets users compose these tools either visually (a Scratch-inspired node canvas) or textually (a small Python-flavored DSL), with full bidirectional translation between the two. Pipelines are content-addressed for instant resume, type-checked at edit time, resource-scheduled, and reproducible by construction. New tools are added by dropping a single self-describing Python file into a directory — no registry edits, no scheduler patches.

The design rests on six commitments:

1. **One source of truth.** Modules self-describe; there is no separate registry to keep in sync.
2. **Handles, not files.** Data flows as typed references; the engine materializes paths only when a module asks.
3. **Cache everything, with tiered retention.** Every node's output is keyed by `hash(module_version, inputs, params)`. Costly outputs are kept; cheap ones evict.
4. **Be honest about resources.** Modules declare what they need; the scheduler honors it from day one.
5. **Reproducibility is the substrate, not a feature.** Provenance follows every output; pipelines can be frozen to pinned module versions for publication.
6. **Async-friendly core.** The orchestrator never blocks on a subprocess. Live progress and logs stream regardless of pipeline load.

---

## 2. Design Principles

**Strict structural typing with escape hatches.** Pipelines are typed dataflow programs. A connection is valid iff the source's output type satisfies the destination's input type. Subtype unions, opt-in auto-converters, and metadata predicates cover the cases pure exact-match rules cannot.

**The DAG is the program.** A pipeline is a directed acyclic graph of typed function calls. The visual editor and the DSL are two views of the same underlying AST. Neither is canonical; both round-trip.

**No hidden state inside modules.** A module is a pure function from typed inputs to typed outputs, modulo declared side effects (logging, progress, subprocesses). This is what makes caching, parallel execution, and provenance tractable.

**Static DAG for v1.** No loops, no conditionals, no dynamic dispatch. Adding control flow turns the DSL into a programming language, with all the implementation and pedagogical costs that implies. Scatter/gather over lists is the only concession to parallelism, and it is deferred to v1.1.

**Single-machine first.** Distributed execution is a layered concern. v1 targets one workstation, possibly with GPU. The execution model permits later extension to job queues without rewriting the core.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  1. Frontend                                            │
│     Visual node canvas  ⇄  DSL text editor              │
│     (React + reactflow or equivalent)                   │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket: JSON-RPC + event stream
                         ▼
┌─────────────────────────────────────────────────────────┐
│  2. Orchestrator (orchestrator.py)                      │
│     - Async HTTP/WebSocket server (asyncio)             │
│     - Pipeline storage & versioning                     │
│     - Type-checks pipelines at edit time                │
│     - Translates visual graph ⇄ DSL AST ⇄ run plan      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  3. Scheduler (scheduler.py)                            │
│     - Topological sort + parallelism                    │
│     - Resource queue (GPU, RAM, CPU)                    │
│     - Content-addressed cache with tiered retention     │
│     - Streams progress/logs/metrics to orchestrator     │
└────────────────────────┬────────────────────────────────┘
                         │ thread pool for module execution
                         ▼
┌─────────────────────────────────────────────────────────┐
│  4. Module Layer (modules/)                             │
│     Self-describing Python files. Decorator-registered. │
│     Optional containerized execution via ctx.run().     │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Concurrency model

The orchestrator runs on `asyncio`. WebSocket events (progress, logs, metrics) fan out to connected clients without ever waiting on a subprocess. Module execution itself happens in a thread pool — the GIL is released during `subprocess.wait` and the heavy lifting is shelled out, so threads are appropriate and avoid forcing async coloring on module authors. Modules that do significant in-process Python work on large structures should yield via `ctx.checkpoint()` (a no-op call that the runtime uses as a cancellation/log-flush point).

### 3.2 Orchestrator (`orchestrator.py`)

Async user-facing process. Serves the frontend, owns pipeline storage (a directory of `.pipeline.dsl` files with optional `.layout.json` sidecars), and is responsible for *static* correctness: type-checking, dangling-input detection, cycle detection.

### 3.3 Scheduler (`scheduler.py`)

The execution engine. Receives a validated run plan, walks the DAG in topological order, and dispatches each node to a worker subject to resource availability and cache state. Streams events back to the orchestrator over an internal asyncio queue.

### 3.4 Module Layer (`modules/`)

Each `*.py` file in this directory contains one or more module class definitions. The scheduler discovers them at boot by importing the package and collecting everything decorated with `@module`. There is no central registration file to edit.

---

## 4. The Type System

Type annotations use Python's standard `Generic[T]` machinery so that modules are IDE-completable, mypy-checkable, and don't require a custom static analyzer.

### 4.1 Hierarchy

```python
# types.py
from typing import Generic, TypeVar, Callable, Any
from dataclasses import dataclass

@dataclass
class DataType:
    name: str
    terminal: bool = False

class Structure:
    PDB   = DataType("Structure.PDB")
    mmCIF = DataType("Structure.mmCIF")

class Sequence:
    FASTA = DataType("Sequence.FASTA")
    FASTQ = DataType("Sequence.FASTQ")

class Visual:
    PNG   = DataType("Visual.PNG", terminal=True)
    JPG   = DataType("Visual.JPG", terminal=True)
    Web3D = DataType("Visual.Web3D", terminal=True)

class Text:
    RawString = DataType("Text.RawString")
    Integer   = DataType("Text.Integer")
    Float     = DataType("Text.Float")
    Score     = DataType("Text.Score")

T = TypeVar("T", bound=DataType)

class Input(Generic[T]):
    def __init__(self, requires: Callable[[dict], bool] | None = None):
        self.requires = requires

class Output(Generic[T]):
    pass

class Param(Generic[T]):
    def __init__(self, default: Any = None):
        self.default = default
```

The `Type.Structure.PDB` style from earlier drafts is a convenience alias: `Type = SimpleNamespace(Structure=Structure, Sequence=Sequence, ...)`.

### 4.2 Connection rules

A wire from output `A` to input `B` is valid iff:

1. `A`'s declared type is a subtype of `B`'s declared type, **or**
2. A registered converter `C: type(A) → type(B)` exists. The scheduler suggests it; the user confirms; the converter node appears in the graph explicitly. There are no hidden conversions.

Type parents accept any subtype: `Input[Structure]` admits both `Structure.PDB` and `Structure.mmCIF`. Unions are explicit: `Input[Structure.PDB | Structure.mmCIF]`.

Converter suggestion is direct (1-hop) only in v1. Multi-hop pathfinding through the converter graph is a v1.5 feature if real usage demands it.

### 4.3 Handles and metadata

Every typed datum is a `Handle`, not raw bytes:

```python
@dataclass
class Handle:
    type:     DataType
    path:     Path
    hash:     str           # content hash (sha256)
    metadata: dict          # type-specific facts
```

Modules can declare metadata predicates as preconditions:

```python
class SomeDockingModule:
    receptor: Input[Structure.PDB] = Input(
        requires=lambda m: m.get("chains", 0) >= 1A visual node canvas (React + reactflow)
        
    )
```

The orchestrator evaluates these statically (against metadata propagated from upstream outputs) and at runtime (against the actual handle). This catches the "wrong-shape input" class of errors before it costs three GPU-hours.

### 4.4 Terminal types

`Visual.PNG`, `Visual.JPG`, `Visual.Web3D` carry `terminal=True`. The default validator warns when a terminal type feeds a non-`OUTPUT` consumer, but this is a hint, not a hard ban — modules may opt in with `accepts_terminal=True`.

---

## 5. Module Specification

### 5.1 The contract

```python
from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text

@module(
    name="RFDIFFUSION",
    category="design",
    version="1.5.0",
    resources={"gpu": 1, "memory_gb": 24},
    container="ghcr.io/rosettacommons/rfdiffusion:1.5.0",  # optional
    retention="permanent",                                  # see §6.3
    hardware_sensitive=True,                                # see §6.1
)
class RFDiffusion:
    """Backbone design via RFdiffusion."""

    pdb_file: Input[Structure.PDB]
    hotspot:  Param[Text.RawString]
    length:   Param[Text.Integer] = Param(default=100)
    cycle:    Param[Text.Integer] = Param(default=50)

    designed_pdb: Output[Structure.PDB]

    def execute(self, ctx):
        out = ctx.workdir / "designed.pdb"
        ctx.progress(0, self.cycle.value, "starting RFdiffusion")
        ctx.run([
            "rfdiffusion",
            f"inference.input_pdb={ctx.path(self.pdb_file)}",
            f"contigmap.contigs=[{self.hotspot.value}]",
            f"inference.num_designs={self.cycle.value}",
        ])
        ctx.publish("designed_pdb", out, metadata={
            "chains":   1,
            "residues": self.length.value,
        })
```

### 5.2 The ExecutionContext

The single seam where modules meet the runtime:

```python
class ExecutionContext:
    workdir: Path                              # transient scratch dir

    def path(self, handle: Handle) -> Path:    # materialize an input
    def run(self, argv: list, **kwargs):       # subprocess with log capture
    def progress(self, current: int, total: int, message: str = ""):
    def log(self, line: str, stream: str = "stdout"):
    def metric(self, key: str, value: float):  # streaming metric
    def publish(self, name: str, path: Path, metadata: dict | None = None):
    def checkpoint(self) -> None:              # cancellation/yield point
    def env(self, key: str) -> str:            # secrets (see §7.4)
```

`ctx.run` captures stdout/stderr line-by-line and feeds them through `ctx.log` automatically. `ctx.progress` and `ctx.metric` drive live UI elements. Modules never touch the WebSocket, the cache, or the resource budget directly — the context mediates everything.

### 5.3 Converter modules

Type converters use the same decorator with `converter=True`. The scheduler indexes them and offers them when wire types don't match:

```python
@module(name="PDB_TO_FASTA", converter=True, retention="ephemeral")
class PdbToFasta:
    pdb:   Input[Structure.PDB]
    fasta: Output[Sequence.FASTA]
    def execute(self, ctx): ...
```

---

## 6. The Execution Engine

### 6.1 Content-addressed caching

Every node's output is keyed by:

```python
cache_key = sha256(
    module_name,
    module_version,
    sorted(input_handle_hashes),
    canonical_json(param_values),
    container_digest,         # if containerized
    hardware_fingerprint,     # if hardware_sensitive=True
)
```

The cache lives at `~/.chaperonin/cache/<key>/{outputs/, manifest.json}`. Before dispatching a node, the scheduler computes its key; on hit, it materializes handles from the cache and skips execution entirely. On miss, it runs the node and writes the result.

**Hardware sensitivity.** Some bio tools — AlphaFold, RFdiffusion — produce subtly different coordinates on different GPU generations due to fp32/tf32 paths and CUDA driver differences. Modules can opt into hardware-aware caching with `hardware_sensitive=True`, which appends `(gpu_model, cuda_version, driver_version)` to the cache key. Default is off: blindly hashing hardware everywhere would destroy cache value across machines. When a cache hit is found that was produced on different hardware (sensitive or not), the scheduler emits a warning event.

**Nondeterminism detection.** If a node is re-executed (e.g., due to a `--no-cache` flag) and produces an output with a different content hash from the cached entry under the same key, the scheduler flags it as nondeterministic. This catches uncontrolled random seeds, unstable solvers, and time-dependent outputs — all common in bio tooling.

Consequences of the caching model:

- Tweak a downstream parameter — upstream nodes don't re-run.
- Re-open a pipeline from yesterday — it's already done.
- Share a pipeline with a collaborator — given matching module versions and inputs, they verify your results without redoing the compute.

For a domain where single steps cost hours of GPU time, this is the difference between a usable tool and a research curiosity.

### 6.2 Resource scheduling

The scheduler is resource-aware from day one, even when the budget is trivial. The dispatch loop consults a `ResourceBudget` predicate before launching any node:

```python
budget = ResourceBudget({"gpu": 1, "memory_gb": 64, "cpu_cores": 16})

# v1: real semaphore-backed predicate
# v0.1: lambda _: True  (always-allow, same call site)
```

This is the seam Gemini correctly flagged: building it in late means rewriting the dispatch loop. Building it in early — even as a no-op — lets the implementation graduate without disturbing the call site.

A node is dispatched only when its declared `resources` fit the remaining budget. CPU-only converters run in parallel. GPU nodes serialize on a single-GPU box. The whole thing fits on top of an `asyncio.BoundedSemaphore` per resource class, with a thread-pool executor consuming the queue.

### 6.3 Tiered cache retention

A single LRU policy would routinely evict a 4-hour AlphaFold output to save a 2-second PyMOL render. Modules declare a retention class:

| Class        | Compute cost | Typical size | Eviction policy                          | Examples                          |
|--------------|--------------|--------------|------------------------------------------|-----------------------------------|
| `permanent`  | High (hrs)   | KB–MB        | Never auto-evict; manual prune only.     | AlphaFold PDBs, RFdiffusion outs  |
| `bulky`      | High (hrs)   | GB+          | LRU with size cap; warn before evict.    | MD trajectories, large MSAs       |
| `standard`   | Medium       | MB           | LRU with default cap.                    | Rosetta scores, docking poses     |
| `ephemeral`  | Low (s)      | KB           | Aggressive LRU.                          | Converters, PyMOL renders         |

The cache directory is structured by tier (`cache/permanent/...`, `cache/bulky/...`) so eviction passes can target each independently. A `chaperonin cache` CLI exposes `prune`, `gc`, and `stats` subcommands; full auto-eviction is opt-in via a config file.

### 6.4 Live observability

The Orchestrator-to-frontend WebSocket carries a structured event stream:

```
pipeline.start     { run_id, total_nodes }
pipeline.done      { run_id, status, summary }
node.queued        { node_id }
node.cache_hit     { node_id, cache_key, hardware_match: true|false }
node.running       { node_id, resources_acquired }
node.log           { node_id, stream, line, ts }
node.progress      { node_id, current, total, message }
node.metric        { node_id, key, value, ts }
node.done          { node_id, outputs: [...] }
node.failed        { node_id, error, traceback }
node.warning       { node_id, kind, detail }   # e.g. nondeterminism, hardware mismatch
```

The UI renders progress bars on each node, expandable log panes, and metric sparklines. When AlphaFold streams pLDDT scores, the user sees them as they happen.

### 6.5 Containerized execution (optional)

When a module declares `container=...`, `ctx.run` executes inside that image via Docker or Apptainer, mounting the workdir read-write and inputs read-only. The container digest is hashed into the cache key, so updating an image automatically invalidates affected entries. Modules without `container` run on the host — the educational path stays simple, the production path stays reproducible.

---

## 7. The Pipeline DSL

### 7.1 Grammar (informal)

```
pipeline      := statement*
statement     := assignment | output_stmt | comment
assignment    := identifier ("," identifier)* "=" call
call          := identifier ("@" version)? "(" arg_list? ")"
version       := semver_literal | "latest"
arg_list      := arg ("," arg)*
arg           := identifier "=" expression | expression
expression    := identifier | literal | call | env_ref
env_ref       := "env" "(" string ")"
output_stmt   := "output" "(" expression ("," "name" "=" string)? ")"
```

Implementable in roughly 60 lines of Lark.

### 7.2 Example

```python
# Backbone design → relax → render
pdb     = input(Structure.PDB, label="Target scaffold")
hotspot = input(Text.RawString, default="A50-60")

designed         = rfdiffusion(pdb=pdb, hotspot=hotspot, length=100, cycle=50)
relaxed          = rosetta_relax(structure=designed)
rendered, scene  = pymol(structure=relaxed, style="cartoon")

output(rendered, name="render")
output(relaxed,  name="final_structure")
```

### 7.3 Version pinning and freeze

By default, module calls resolve against the highest-numbered installed version. Explicit pinning is supported:

```python
# Use whatever's installed (development default)
designed = rfdiffusion(pdb=pdb, hotspot=hotspot, length=100, cycle=50)

# Pin to a specific version (publication default)
designed = rfdiffusion@1.5.0(pdb=pdb, hotspot=hotspot, length=100, cycle=50)
```

A CLI command rewrites a pipeline to its fully pinned form:

```bash
chaperonin freeze pipeline.dsl > pipeline.frozen.dsl
```

The frozen file is what accompanies a publication. The unfrozen file is what you edit day-to-day.

### 7.4 Secrets

Secrets never appear in the DSL or the cache key. Modules that need them call `ctx.env("KEY_NAME")`, which reads from `~/.config/chaperonin/secrets.env`. The corresponding DSL surface, when a secret is bound at pipeline level:

```python
api_key = env("BLAST_API_KEY")
hits    = remote_blast(sequence=seq, api_key=api_key)
```

`env(...)` resolves at runtime, propagates as an environment variable into `ctx.run`, and is excluded from both the cache key and the provenance sidecar. Secrets must not affect output content; tools whose results depend on which credential is used (per-user database access, e.g.) should expose the access path as an explicit parameter instead.

### 7.5 Naming

Auto-generated identifiers when round-tripping from the visual graph use `<module_name>_<n>` (`rfdiffusion_1`, `pymol_2`), never `VAR_1`. Users will read this code.

---

## 8. Visual Editor & Round-Trip

The visual editor is a node canvas with the conventional shape: blocks with input terminals on top, output terminals on bottom, draggable wires between. The block palette is built from the module registry at runtime.

### 8.1 Block visual contract

```
┌─────────────────────────────────────┐
│  pdb_file ▼   hotspot ▼   length ▼  │   ← input terminals (top)
├─────────────────────────────────────┤
│            RFDIFFUSION              │   ← module name
│        ⏵ 47/50  pLDDT: 0.82         │   ← live status
├─────────────────────────────────────┤
│           designed_pdb ▼            │   ← output terminal (bottom)
└─────────────────────────────────────┘
```

### 8.2 Round-trip

The DSL is canonical; the visual graph is a view over it. Saving a pipeline writes two files:

- `pipeline.dsl` — the source of truth.
- `pipeline.layout.json` — node positions, viewport, UI-only metadata.

Edits in either view update the in-memory AST; both views re-render from it. Layout is preserved across DSL edits via stable node IDs (assigned at parse time, derived from a hash of the binding's position on first save).

---

## 9. Reproducibility & Provenance

Every output file in `/outputs/` is accompanied by a `<name>.provenance.json` sidecar:

```json
{
  "chaperonin_version": "0.1.0",
  "produced_at": "2026-05-17T14:32:11Z",
  "wall_time_s": 4821.3,
  "dag": {
    "nodes": [
      {
        "id": "rfdiffusion_1",
        "module": "RFDIFFUSION",
        "version": "1.5.0",
        "container": "ghcr.io/rosettacommons/rfdiffusion@sha256:...",
        "hardware": { "gpu": "NVIDIA A100", "cuda": "12.3", "driver": "545.23.08" },
        "params":   { "hotspot": "A50-60", "length": 100, "cycle": 50 },
        "inputs":   { "pdb_file": "sha256:..." },
        "outputs":  { "designed_pdb": "sha256:..." },
        "seed": 12345
      }
    ],
    "edges": [ ["rfdiffusion_1.designed_pdb", "pymol_1.structure"] ]
  }
}
```

A provenance file is sufficient to reconstruct the full DAG that produced an output. For publication, it accompanies the supplementary materials alongside the frozen DSL.

---

## 10. Initial Module Roadmap

| Module          | Inputs                                                  | Outputs                                 | Notes                                                |
|-----------------|---------------------------------------------------------|-----------------------------------------|------------------------------------------------------|
| `PDB_TO_FASTA`  | `Structure.PDB`                                         | `Sequence.FASTA`                        | Trivial converter; first end-to-end test.            |
| `PYMOL`         | `Structure.PDB` + style params                          | `Visual.PNG`, `Visual.Web3D`            | Headless render; well-documented Python API.         |
| `RFDIFFUSION`   | `Structure.PDB`, hotspot, length, cycle                 | `Structure.PDB`                         | Containerized; GPU-bound; hardware-sensitive.        |
| `ALPHAFOLD`     | `Sequence.FASTA`                                        | `Structure.PDB` (with pLDDT metadata)   | Outputs PDB only; rendering is downstream PyMOL.     |
| `ROSETTAFOLD`   | `Structure.PDB`, [aux]                                  | `Structure.PDB`, `Text.Score`           | Score returned as a separate output, not bundled.    |
| `ROSETTA_RELAX` | `Structure.PDB`                                         | `Structure.PDB`                         | Common cleanup step between design and scoring.      |

AlphaFold and RoseTTAFold do not emit `Visual.Web3D` natively. The flat-pipeline principle means visual rendering is always a downstream PyMOL or viewer block, never bundled into the structural module itself.

---

## 11. Extension: Adding a New Tool

For a third-party developer:

1. Create `modules/my_tool.py`.
2. Define a class decorated with `@module(...)`.
3. Restart the orchestrator.

That is the entire procedure. No JSON edits, no scheduler patches, no registry updates. The decorator handles registration; introspection on type annotations exposes the block to the frontend; the runtime contract is honored via `ExecutionContext`.

If the new tool introduces a new type, add it to `chaperonin/types.py` — the type registry is similarly self-describing, and new types become available to all modules automatically.

---

## 12. Implementation Roadmap

A staged plan that minimizes throwaway work. Resource awareness is wired in from phase 1 (as a no-op predicate) so it can graduate without disturbing the dispatch site.

1. **Core skeleton.** `ExecutionContext`, `@module` decorator, async scheduler shell with a no-op `ResourceBudget` predicate, one trivial module (file copy) for end-to-end smoke test.
2. **Type registry from introspection.** Module discovery, type checking, `Generic[T]` annotations, no JSON.
3. **Content-addressed cache with tier classes.** Build before the frontend exists, with CLI-driven testing. Hardware tagging behind an opt-in flag.
4. **DSL parser and emitter.** Lark grammar, AST, executor, freeze CLI. Pipelines runnable from text alone.
5. **First real modules.** `PDB_TO_FASTA`, then `PYMOL`, then `RFDIFFUSION`, then `ALPHAFOLD`.
6. **Resource budget activated.** Swap the no-op predicate for real semaphore-backed scheduling. The interface is unchanged.
7. **WebSocket event protocol.** Structured events with no UI yet — exercise the contract from a test client.
8. **Visual frontend.** React + reactflow (or equivalent), bidirectional AST sync, layout sidecar.
9. **Containerization hook.** Docker/Apptainer support in `ctx.run`.
10. **Provenance sidecars and secret handling.** Final polish layer.

Building the UI relatively late is deliberate: by step 8 the data model is concrete and well-tested, so the frontend is a thin layer over a clear contract rather than a leaky abstraction influencing the core.

---

## 13. Out of Scope for v1

Each of these is deferable without architectural penalty:

- **Loops and conditionals.** Static DAG only. Control flow turns the DSL into a programming language.
- **Scatter/gather over lists.** Add via a `List[T]` type and `map(module, list_input)` after v1 stabilizes.
- **Multi-hop auto-converter pathfinding.** 1-hop suggestions only in v1.
- **Distributed / cluster execution.** The scheduler interface accepts alternative backends; not implemented in v1.
- **Real-time multi-user collaboration.** Pipelines are single-user files in v1.
- **Cloud storage for inputs/outputs.** Local filesystem only.
- **GUI plugin system.** Custom block widgets (e.g., a structure preview) are deferred; default rendering only.

---

## 14. Open Questions

Most of the original open questions have been resolved (see §6.3 retention, §7.3 versioning, §7.4 secrets). What remains:

1. **Editor framework.** React + reactflow is the obvious choice but a heavy dependency. A vanilla-JS or Svelte alternative may be worth evaluating for build simplicity.
2. **DSL extensibility.** Should the grammar permit module-defined syntactic sugar? Probably not in v1; uniformity helps the round-trip.
3. **Metadata predicate language.** Currently arbitrary Python lambdas. Should this be a restricted expression language for safety once pipelines are shared?
4. **Final name.** *Chaperonin* is the current working title — biologically meaningful and metaphorically apt. Alternatives kept in reserve: *Anneal* (short, dual CS/bio meaning), *Lattice* (structural ordering), *Foldworks*. Worth deciding before any public artifacts ship.

---

## Appendix A — Glossary

- **Handle** — a typed reference to a value (path, hash, type, metadata). The unit of inter-module communication.
- **Module** — a self-describing Python class wrapping one external tool or computation.
- **Pipeline** — a DAG of typed module instances, persisted as a `.dsl` file plus optional layout sidecar.
- **Cache key** — `hash(module_version, inputs, params, container_digest, [hardware])`. Determines cache hit/miss.
- **Converter** — a module flagged as a type converter, eligible for auto-insertion when wire types don't match.
- **ExecutionContext** — the per-node runtime API for logging, progress, subprocess, secrets, and output declaration.
- **Retention class** — `permanent | bulky | standard | ephemeral`. Determines cache eviction behavior.
- **Frozen pipeline** — a `.dsl` file in which every module call has an explicit version pin; the publication-ready form.

---

## Appendix B — Prior Art

Chaperonin occupies a specific niche between several existing systems, and is informed by their tradeoffs:

- **Snakemake / Nextflow.** Production bioinformatics workflow engines. Powerful but text-only, with steep learning curves and shell-script-flavored configuration. Chaperonin borrows their caching model but targets interactive iteration and a visual front door for non-programmers.
- **Galaxy.** A web-based bioinformatics platform with visual pipelines. Excellent for genomics but server-hosted, opinionated about its module ecosystem, and not designed for local desktop GPU work.
- **KNIME / Apache NiFi.** General-purpose visual dataflow tools. Strong UX, weak on scientific reproducibility primitives (provenance, content-addressed caching, container pinning).
- **ComfyUI.** Node-based interface for image generation. Demonstrates that visual pipelines work well for creative iteration on GPU-bound tools — a direct inspiration for the interaction model.

Chaperonin's bet: combine the reproducibility discipline of Snakemake, the visual interaction model of ComfyUI, the type discipline of a small typed dataflow language, and a strict commitment to plug-and-play module authorship.
