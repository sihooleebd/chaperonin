# Contributing to Chaperonin

Thanks for considering a contribution. This document covers the rough shape of how the project is organized and what we look for in changes.

## Repo layout

```
chaperonin/
├── backend/          # Python orchestrator (stdlib-only)
│   ├── chaperonin/   # core: scheduler, scopes, types, context, server, WS
│   ├── modules/      # one file per tool — @module decorated
│   └── tests/        # unittest
├── frontend/         # production React + ReactFlow app
├── demo/             # standalone simulation-only mirror (no backend)
├── landing/          # marketing/landing page
├── docs/superpowers/
│   ├── specs/        # design specs
│   └── plans/        # implementation plans
├── Dockerfile        # multi-stage: frontend build + python runtime
└── README.md
```

## Setting up

```bash
git clone https://github.com/sihooleebd/chaperonin
cd chaperonin

# Backend — no install. Stdlib only.
cd backend
python3 -m unittest discover -s tests -p 'test_*.py'

# Frontend
cd ../frontend
npm install
npm run dev   # http://localhost:5173

# In another terminal: backend server for the dev frontend to proxy to
cd backend
python3 -m chaperonin.server
```

Or run the whole thing in a container (matches production):

```bash
docker build -t chaperonin .
docker run -d --name chaperonin \
  -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.chaperonin:$HOME/.chaperonin" \
  -e HOME="$HOME" \
  -e CHAPERONIN_PYMOL_IMAGE=pegi3s/pymol:latest \
  chaperonin
```

## Before opening a PR

1. **All backend tests must pass.** `python3 -m unittest discover -s tests -p 'test_*.py'` from `backend/`. There are currently 58 of them and they run in well under a second.
2. **Add tests for new behavior.** If you change the scheduler, scopes, types, or a control primitive: write a unit test that fails before the change and passes after. Use simulate mode (`run_pipeline(..., simulate=True)`) for end-to-end tests that don't need Docker.
3. **No new pip dependencies in the backend.** The orchestrator is intentionally stdlib-only. If you genuinely need a third-party library, open an issue first to discuss.
4. **Mirror UI changes to `demo/`.** The demo is a frozen mirror that simulates execution offline. Any new node component / palette entry / DSL keyword has to be copied across (see the table in `CLAUDE.md`). The demo's `App.jsx` does *not* import `backend.js` or `graph.js` — leave those out of the mirror.
5. **Rebuild the container when changing backend modules.** The chaperonin container bakes `backend/` in at build time. After editing a module file, `docker build -t chaperonin .` then restart the container — otherwise you'll be running stale code.

## Adding a module

A module is one self-describing Python file in `backend/modules/`. Example skeleton:

```python
"""MyTool: one-line description."""

import os
from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text

IMAGE = os.environ.get("CHAPERONIN_MYTOOL_IMAGE", "owner/mytool:latest")


@module(
    name="MYTOOL",
    label="My Tool",
    category="design",          # design | prediction | refinement | visualization | converter
    description="What it does in one sentence",
    resources={"gpu": 0, "memory_gb": 4},
    retention="standard",       # permanent | standard | ephemeral
    container=IMAGE,
    docker_args=[],             # extra `docker run` flags, e.g. ["--shm-size=2g"]
)
class MyTool:
    structure: Input[Structure.PDB]
    threshold: Param[Text.Float] = Param(default=0.5)
    result: Output[Structure.PDB]
    score: Output[Text.Score]

    def execute(self, ctx):
        out = ctx.workdir / "result.pdb"
        ctx.progress(0, 1, "running")
        ctx.run([
            "/path/to/binary/inside/image",
            "--in", str(ctx.path(self.structure)),
            "--out", str(out),
            "--threshold", str(self.threshold.value),
        ])
        ctx.progress(1, 1, "done")
        ctx.publish("result", out)
        ctx.publish("score", value=parse_score(out))  # scalar handle, no path
```

You also need to add a matching entry in `frontend/src/data/modules.js` (and `demo/src/data/modules.js` with mock fields). Update `backend/tests/test_real_modules.py`'s `EXPECTED` fixture to match.

If your module uses GPU (`resources={"gpu": 1, ...}`), it'll be greyed in the palette by default. To run it, set `CHAPERONIN_GPU_AVAILABLE=true` on the chaperonin container.

## Code style

- **Backend Python**: 4-space indent. Type hints encouraged but not enforced. `from __future__ import annotations` for files using `|`-style unions.
- **Frontend JS/JSX**: 2-space indent. Plain ES modules, no TypeScript. Functional components with hooks. ReactFlow nodes go in `frontend/src/components/`.
- **No comments unless the *why* is non-obvious.** Code that's obvious from naming doesn't need explanation. Comments earn their keep by capturing constraints, workarounds, or invariants that would surprise a future reader.

## Reporting bugs

Open an issue with:
- What you ran (DSL or canvas screenshot is fine)
- Expected vs actual behaviour
- Browser console output if it's a frontend crash
- `docker logs chaperonin` tail if it's a backend issue
- OS + architecture (Apple Silicon vs x86 Linux matters for GPU and qemu-emulated images)

## Discussion

Open an issue with the `discussion` label, or message the maintainers (Sihoo Lee, Hangyeol Lim).
