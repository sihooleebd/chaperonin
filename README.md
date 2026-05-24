<img src="./assets/logo-light.svg" width="200" alt="Alt text">

**A modular workflow engine for computational biology.**

Compose RFdiffusion, Rosetta, PyMOL, AlphaFold and friends visually on a node canvas, or textually as a tiny DSL — both round-trip. Pipelines run as a chain of Docker containers spawned by a stdlib-only Python orchestrator. Outputs stream live to the browser; structures render inline.

> *Chaperonins (GroEL, HSP60) are proteins whose function is to assist other proteins in reaching their correct folded state. The metaphor — a system whose job is to help other tools reach their functional output — is the project's mission statement.*

---

## What's in the box

- **Node-graph canvas** (React + ReactFlow) with a typed wire model. Edges are coloured by data type; mismatches are flagged at edit time.
- **DSL editor** in the same panel, bidirectional with the canvas. Edit either side, hit Apply, and the other updates.
- **Inline 3D viewer.** Drop a `Visualizer` node onto the canvas; wire a `Structure.PDB` (or `Visual.PNG`) into it and the result appears inside the node, rotatable, no separate window.
- **Real Docker dispatch.** Module nodes spawn real child containers via the host Docker daemon. Stop button kills them on the spot.
- **Control flow.** `START_FOR` / `END_FOR` loops, `IF` gating, `SAVE` / `GET` scoped variables, `COMPARE` and `SELECT` utilities. Express "run N times, save each design + score, render the lowest-energy one" as a graph.
- **Stdlib-only backend.** No `pip install` — the orchestrator is asyncio + a hand-rolled WebSocket framer + the docker CLI.

---

## Quick start

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

### First pipeline

1. Drag **Input** (Pipeline I/O), pick a PDB file (any from rcsb.org works — e.g. 1CRN).
2. Drag **Rosetta Relax** (Refinement). Wire `Input → Rosetta Relax.structure`.
3. Drag **Visualizer** (Visualization). Wire `Rosetta Relax.relaxed → Visualizer.value`.
4. Click **▶ Run Pipeline**. ~8-10 seconds on a small protein. The relaxed structure renders inside the Visualizer.

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

## Modules

| Module | Category | Container | Notes |
|---|---|---|---|
| `ROSETTA_RELAX` | refinement | `rosettacommons/rosetta` | CPU. Multi-arch image, runs natively on Apple Silicon. Emits relaxed PDB + Rosetta `total_score`. |
| `PYMOL` | visualization | `pegi3s/pymol` | amd64 only, runs under emulation on arm64 (slow but works). Renders PNG + saves a viewable PDB scene. |
| `RFDIFFUSION` | design | `rosettacommons/rfdiffusion` | CPU-mode under emulation on Apple Silicon — *very* slow (30 min – 3 hr per design). Use a Linux+GPU box for real workloads. |
| `ALPHAFOLD`, `ROSETTAFOLD` | prediction | (no public CPU image) | Greyed in the palette unless `CHAPERONIN_GPU_AVAILABLE=true` is set. |
| `PDB_TO_FASTA` | converter | none (host-only) | Extracts protein sequence from PDB. Always available. |
| `VISUALIZER` | visualization | none (host-only) | Renders PDB (3Dmol.js) / PNG / WRL inline in the node. Terminal sink. |

Adding a new module is one Python file under `backend/modules/`. The `@module` decorator self-describes inputs / params / outputs / resources / image; the palette and DSL pick it up automatically on restart.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + ReactFlow, served from chaperonin    │
│  container as static files)                             │
│    canvas  ⇄  DSL editor  ⇄  log panel  ⇄  inline 3D    │
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket  ws://localhost:8000/ws
┌────────────────────▼────────────────────────────────────┐
│  Backend (Python 3.12 stdlib only)                      │
│    asyncio server  →  scheduler  →  per-node dispatch   │
│                                                         │
│    Scheduler: topo-sorts the graph, walks scopes,       │
│    drives FOR loops, gates IF branches, evaluates       │
│    SAVE/GET/COMPARE/SELECT inline.                      │
└────────────────────┬────────────────────────────────────┘
                     │ /var/run/docker.sock (bind-mounted)
┌────────────────────▼────────────────────────────────────┐
│  Host Docker daemon                                     │
│    per-node `docker run --rm --name chaperonin-<id>-…`  │
│      → child containers (Rosetta, PyMOL, RFdiffusion…)  │
└─────────────────────────────────────────────────────────┘
```

The chaperonin container talks to the host Docker daemon via the mounted socket. Each module node spawns a sibling container; bind mounts use identical host/container paths so any path produced by Rosetta resolves identically when PyMOL reads it next.

---

## Configuration

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

## Development

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

---

## Status

This is a working v0.x: the canvas, DSL, control flow, GPU gating, and the Rosetta + PyMOL + Visualizer triple all run end-to-end. RFdiffusion runs under CPU emulation on Apple Silicon but is slow enough that it's mostly a demonstration that the dispatch works — real RFdiffusion needs a CUDA host. AlphaFold and RoseTTAFold are wired but require GPU; their palette entries are greyed unless `CHAPERONIN_GPU_AVAILABLE=true`.

See `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for implementation plans.

---

## Authors

Sihoo Lee · Hangyeol Lim

## License

MIT — see [LICENSE](LICENSE).
