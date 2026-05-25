<p align="center">
  <img src="https://github.com/sihooleebd/chaperonin/raw/main/assets/logo-light.svg" width="320" alt="Chaperonin" />
</p>

<p align="center"><i>A Modular Workflow Engine for Computational Biology</i></p>

<p align="center">
  Sihoo Lee · Hangyeol Lim &nbsp;·&nbsp; 2026-1 한국과학영재학교 정보과학 프로젝트 발표회
</p>

---

Compose RFdiffusion, Rosetta, PyMOL, AlphaFold and friends visually on a node canvas, or textually as a tiny DSL — both round-trip. Pipelines run as a chain of Docker containers spawned by a stdlib-only Python orchestrator. Outputs stream live to the browser; structures render inline.

> *Chaperonins (GroEL, HSP60) are proteins whose function is to assist other proteins in reaching their correct folded state. The metaphor — a system whose job is to help other tools reach their functional output — is the project's mission statement.*

---

## 01 · Motivation

Proteins are central to every biological process, and designing new ones increasingly relies on tools like RFdiffusion, Rosetta, and AlphaFold. But three things stop biologists from actually using them:

| | Problem | Chaperonin's answer |
|---|---|---|
| ① | **CS / CLI barrier** — programming required; the terminal is unfamiliar to most biologists. | **Block-coding GUI** — drag-and-wire interface; no terminal knowledge needed. |
| ② | **Format fragmentation** — every tool has its own schema, conversion is manual. | **Typed, auto-converted edges** — self-contained modules; the type system handles compatibility. |
| ③ | **No definite protocol** — there's no standard way to compose the steps. | **The canvas *is* the protocol** — readable by experts and novices alike. |

Each tool is a self-contained module, so adding or modifying a tool means touching one file — not the whole program.

---

## 02 · Workflow — five steps, no shell

1. **Drag.** Pick a module from the categorised palette (design, refinement, prediction, visualization, converters).
2. **Wire.** Connect typed handles. Edges are coloured by data type; incompatible wires are refused at edit time.
3. **Validate.** Type-checking and dangling-input detection run before any GPU-hour is spent.
4. **Run.** The scheduler topo-sorts the graph, dispatches each node as a sibling Docker container; the content cache short-circuits hits.
5. **Stream.** Logs, progress bars, and 3D structures stream live into the canvas. Stop kills containers instantly.

---

## 03 · Install & quick start

Requires Docker Desktop (or any Docker daemon) and ~30 GB free disk for the module images.

```bash
git clone https://github.com/sihooleebd/chaperonin
cd chaperonin
docker build -t chaperonin .
docker run -d --name chaperonin \
  -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.chaperonin:$HOME/.chaperonin" \
  -e HOME="$HOME" \
  -e CHAPERONIN_PYMOL_IMAGE=pegi3s/pymol:latest \
  chaperonin
```

Open **http://localhost:8000**. Drag from the palette, wire it up, hit Run.

### Your first pipeline

1. Drag **Input** (Pipeline I/O), pick a PDB file (any from rcsb.org works — e.g. 1CRN).
2. Drag **Rosetta Relax** (Refinement). Wire `Input → Rosetta Relax.structure`.
3. Drag **Visualizer** (Visualization). Wire `Rosetta Relax.relaxed → Visualizer.value`.
4. Click **▶ Run Pipeline**. ~8–10 seconds on a small protein. The relaxed structure renders inside the Visualizer.

### Worst-of-N (control flow)

Paste into the DSL panel, click **Apply DSL**:

```
scaffold_in = input(Structure.PDB, label="scaffold")
n = input(Text.Integer, label="n")

for_trials = start_for(count=n, loop_label="trials")
relaxed = ROSETTA_RELAX(structure=scaffold_in, nstruct=1)
save_design = save(value=relaxed.relaxed, name="designs")
save_score = save(value=relaxed.score, name="scores")
end_trials = end_for(paired_start=for_trials.gate, body_out=save_design.value)

all_designs = get(name="designs")
all_scores = get(name="scores")
best = select(from=all_designs.value, by=all_scores.value, mode="min")
viz = VISUALIZER(value=best.value)
```

Set `n = 3`, pick a scaffold PDB, hit Run. Three Rosetta runs spawn in sequence, each emits a `total_score`, SELECT picks the lowest, Visualizer displays it.

---

## 04 · Architecture — four layers, one socket

```
┌─────────────────────────────────────────────────────────┐
│  ① FRONTEND — React 18 · ReactFlow · 3Dmol.js           │
│    visual canvas  ⇄  DSL editor  ⇄  log panel  ⇄  3D    │
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket · ws://localhost:8000/ws
┌────────────────────▼────────────────────────────────────┐
│  ② ORCHESTRATOR — Python 3.12, stdlib only              │
│    asyncio server  →  scheduler  →  content cache       │
│    hand-rolled WS framer · topo-sort · FOR/IF/SELECT    │
│    sha256-keyed, tiered retention                       │
└────────────────────┬────────────────────────────────────┘
                     │ /var/run/docker.sock (bind-mounted)
┌────────────────────▼────────────────────────────────────┐
│  ③ HOST DOCKER DAEMON — per-node sibling containers     │
│    Rosetta · PyMOL · RFdiffusion · AlphaFold · RoseTTA  │
└─────────────────────────────────────────────────────────┘
```

The chaperonin container talks to the host Docker daemon via the mounted socket. Each module node spawns a sibling container; bind mounts use identical host/container paths so any path produced by Rosetta resolves identically when PyMOL reads it next.

### Type system — hierarchical, covariant

| Namespace | Subtypes |
|---|---|
| `Structure` | `.PDB`, `.mmCIF` |
| `Sequence` | `.FASTA`, `.FASTQ` |
| `Visual` | `.PNG`, `.Web3D` |
| `Text` | `.RawString`, `.Integer`, `.Float`, `.Score` |

An output of type `Structure.PDB` is compatible with an input declared as `Structure`. Union input types use `|` separator: `"Structure.PDB | Sequence.FASTA"`.

---

## 05 · Translation — two views, one AST

The visual canvas and the DSL are two views over the same pipeline AST. Edit either side, hit Apply, the other updates.

```python
# Same pipeline as the canvas above, in DSL form
pdb     = input(Structure.PDB, label="scaffold")
relaxed = ROSETTA_RELAX(structure=pdb, nstruct=1)
viz     = VISUALIZER(value=relaxed.relaxed)
best    = select(from=relaxed.score, mode="min")
```

- `input(TYPE, label="...")` — declares a source
- `VAR = MODULE_ID(input=source.handle, param=value)` — module call
- `output(var.handle, name="...")` — declares a sink
- `???` — unconnected required input (the pipeline will refuse to run)

---

## 06 · Extendability — one Python file, one module

```python
# backend/modules/rfdiffusion.py
from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text

@module(name="RFDIFFUSION", category="design",
    container="ghcr.io/rosettacommons/rfdiffusion:1.5.0",
    resources={"gpu": 1, "memory_gb": 24})
class RFDiffusion:
    pdb_file:     Input[Structure.PDB]
    hotspot:      Param[Text.RawString]
    designed_pdb: Output[Structure.PDB]

    def execute(self, ctx):
        ctx.run(["rfdiffusion", ...])
        ctx.publish("designed_pdb", ctx.workdir / "designed.pdb")
```

Drop a single `.py` file under `backend/modules/`. The `@module` decorator self-describes inputs, params, outputs, resources and container image. **No registry edits, no scheduler patches** — palette, DSL, and canvas pick it up automatically on restart.

### Modules shipped today

| Module | Category | Container | Notes |
|---|---|---|---|
| `ROSETTA_RELAX` | refinement | `rosettacommons/rosetta` | CPU. Multi-arch image, runs natively on Apple Silicon. Emits relaxed PDB + Rosetta `total_score`. |
| `PYMOL` | visualization | `pegi3s/pymol` | amd64 only, runs under emulation on arm64 (slow but works). Renders PNG + saves a viewable PDB scene. |
| `RFDIFFUSION` | design | `rosettacommons/rfdiffusion` | CPU-mode under emulation on Apple Silicon — *very* slow (30 min – 3 hr per design). Use a Linux+GPU box for real workloads. |
| `ALPHAFOLD`, `ROSETTAFOLD` | prediction | (no public CPU image) | Greyed in the palette unless `CHAPERONIN_GPU_AVAILABLE=true` is set. |
| `PDB_TO_FASTA` | converter | none (host-only) | Extracts protein sequence from PDB. Always available. |
| `VISUALIZER` | visualization | none (host-only) | Renders PDB (3Dmol.js) / PNG / WRL inline in the node. Terminal sink. |

---

## 07 · Results — end-to-end on a laptop

### Fig. 1 — Rosetta Relax pipeline

<p align="center">
  <img src="https://github.com/sihooleebd/chaperonin/raw/main/assets/poster/image_1.png" width="720" alt="Rosetta Relax pipeline screenshot" />
</p>

Relaxation is a crucial preprocessing step for protein design tools like RoseTTAFold. The pipeline takes a `.pdb` structure as input, runs it through the **Rosetta Relax** module, and renders the relaxed structure via the **Visualizer** module. From the user's perspective, the entire process is three connected nodes on a visual canvas — no CLI. The relaxed structure renders directly inside the program, no external viewer needed.

### Fig. 2 — Iterative execution & conditional logic

<p align="center">
  <img src="https://github.com/sihooleebd/chaperonin/raw/main/assets/poster/image_2.png" width="720" alt="Iterative execution pipeline screenshot" />
</p>

The program runs Rosetta Relax three times and selects the output with the lowest energy score, automatically returning the most stable structure via the **Select** node. Every other tool can be wrapped in `START_FOR` / `END_FOR` / `SELECT` the same way. Multiple trials + conditional selection inside a single pipeline let researchers systematically search a range of outputs and identify the optimal result.

### Fig. 3 — De novo protein design pipeline

<p align="center">
  <img src="https://github.com/sihooleebd/chaperonin/raw/main/assets/poster/image_3.png" width="720" alt="De novo protein design pipeline screenshot" />
</p>

A complete *de novo* protein design pipeline, analogous to a real-world drug-development workflow. A target protein structure is passed through the **RFDiffusion** module to generate a binding protein; the result flows into **AlphaFold** and is evaluated by its iPAE score (a measure of positional prediction accuracy). The graph directly mirrors the process of developing a binding protein in drug discovery.

---

## 08 · Configuration

Environment variables on the chaperonin container:

| Var | Default | Purpose |
|---|---|---|
| `CHAPERONIN_GPU_AVAILABLE` | `false` | Ungrays GPU modules in the palette. Set to `true` on a Linux+NVIDIA box. |
| `CHAPERONIN_PYMOL_IMAGE` | `pymol-open-source:latest` | Override PyMOL container image. `pegi3s/pymol:latest` works on most hosts. |
| `CHAPERONIN_RFDIFFUSION_IMAGE` | `rosettacommons/rfdiffusion:latest` | Override RFdiffusion image. |
| `CHAPERONIN_ALPHAFOLD_IMAGE` | `ghcr.io/sokrypton/colabfold:latest` | Override AlphaFold/ColabFold image. |
| `CHAPERONIN_ROSETTA_IMAGE` | `rosettacommons/rosetta:latest` | Override Rosetta image. |
| `CHAPERONIN_SIMULATE` | unset | If `1`/`true`, all modules fake execution (placeholder outputs). Useful for UI work without Docker. |
| `CHAPERONIN_FRONTEND_DIST` | `/app/frontend_dist` | Path to served static frontend bundle. |

---

## 09 · Development

```bash
# Backend tests (stdlib only, no install needed)
cd backend
python3 -m unittest discover -s tests -p 'test_*.py'

# Frontend dev server (hot reload, proxies /api and /ws to localhost:8000)
cd frontend
npm install
npm run dev   # http://localhost:5173

# Demo mode (no backend, simulation only)
cd demo
npm install
npm run dev
```

The demo path uses `simulation.js` to fake module execution — useful for UI-only changes or showing the project without a Docker daemon.

See [docs/superpowers/specs/](docs/superpowers/specs/) for design specs and [docs/superpowers/plans/](docs/superpowers/plans/) for implementation plans.

---

## Testimonial

> **"Being able to connect different computational programs and run them on a single platform would be enormously convenient. If Chaperonin really lets a researcher wire the tools together with a mouse and execute them, it will be an exceptionally practical bioinformatics tool."**
>
> — **Prof. An Jeong-Hun**, Dept. of Chemistry & Biology

---

## Status

This is a working v0.x: the canvas, DSL, control flow, GPU gating, and the Rosetta + PyMOL + Visualizer triple all run end-to-end. RFdiffusion runs under CPU emulation on Apple Silicon but is slow enough that it's mostly a demonstration that the dispatch works — real RFdiffusion needs a CUDA host. AlphaFold and RoseTTAFold are wired but require GPU; their palette entries are greyed unless `CHAPERONIN_GPU_AVAILABLE=true`.

---

## Authors

Sihoo Lee · Hangyeol Lim — 2026-1 한국과학영재학교 정보과학 프로젝트 발표회

## License

MIT — see [LICENSE](LICENSE).
