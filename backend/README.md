# Chaperonin backend — the translation layer

Connects the frontend pipeline to real, Docker-packaged biology tools. It takes
the graph the frontend sends over WebSocket, translates each node into a
`docker run <image> …` invocation, runs it, and streams progress/logs/outputs
back. Stdlib-only — no `pip install`.

```
backend/
├── chaperonin/
│   ├── types.py        # DataType hierarchy + is_compatible            (§4)
│   ├── decorator.py    # @module + Input/Param/Output + REGISTRY       (§5.1)
│   ├── registry.py     # discover(): import modules/ → REGISTRY         (§3.4)
│   ├── introspect.py   # REGISTRY → JSON for the palette                (§11)
│   ├── dockercmd.py    # ★ module + handles → `docker run` argv         (§6.5)
│   ├── context.py      # ExecutionContext: ctx.run host or container    (§5.2)
│   ├── scheduler.py    # graph → topo run plan, handle passing, events  (§3.3,§6)
│   ├── ws_protocol.py  # minimal RFC 6455 framing (stdlib WebSocket)
│   └── server.py       # /ws + /api/modules + /api/upload + /api/outputs (§3.2)
├── modules/            # ★ ONE FILE PER TOOL — the single source of truth
│   ├── pdb_to_fasta.py #   host, no container, runs today
│   ├── pymol.py · rfdiffusion.py · alphafold.py · rosettafold.py · rosetta_relax.py
└── tests/              # 37 unit tests + smoke_server.py (end-to-end)
```

## Where the Docker connection happens

1. `scheduler.run_pipeline` walks the graph in topological order and, for each
   node, looks up its `ModuleSpec` and resolves inputs from incoming edges.
2. The module's `execute(self, ctx)` calls `ctx.run([...])`.
3. `ExecutionContext.build_command` → `dockercmd.build_docker_command` turns that
   into:
   ```
   docker run --rm [--gpus all] [--entrypoint X] [extra args] \
     -v <run-root>:<run-root>:rw  -v <input-dir>:<input-dir>:ro \
     -w <node-workdir>  <image>  <argv…>
   ```
   Host paths are bind-mounted at the same path inside the container, so inputs
   (upstream outputs + uploads) resolve identically. The exact command is logged
   as a `node.log` line, so you can see the translation.

## Run

```bash
cd backend
python3 -m chaperonin.server                       # real Docker execution
CHAPERONIN_SIMULATE=1 python3 -m chaperonin.server # fake it, no Docker (testing)
```

Then `cd frontend && npm run dev`. The Vite proxy forwards `/ws` and `/api`.

## Test

```bash
python3 -m unittest discover -s tests              # 37 unit tests
python3 -m chaperonin.server &                     # then:
python3 tests/smoke_server.py                      # full upload→run→serve
```

## Connect your images (when you have them)

Each containerized module reads its image from an env var (or edit the one
`IMAGE = …` line):

| Module        | Env var                          |
|---------------|----------------------------------|
| PYMOL         | `CHAPERONIN_PYMOL_IMAGE`         |
| RFDIFFUSION   | `CHAPERONIN_RFDIFFUSION_IMAGE`   |
| ALPHAFOLD     | `CHAPERONIN_ALPHAFOLD_IMAGE`     |
| ROSETTAFOLD   | `CHAPERONIN_ROSETTAFOLD_IMAGE`   |
| ROSETTA_RELAX | `CHAPERONIN_ROSETTA_IMAGE`       |

For image-specific needs, a module can also declare `entrypoint=...` and
`docker_args=[...]` (e.g. `--shm-size=8g`) in its `@module(...)`.

## Known gap for *real* runs

This frontend version sends no input file path for input-nodes, so real
file-consuming tools have nothing to read yet. Simulate mode ignores inputs (so
it works now); wiring real inputs needs a file-upload field on the input-node
that sets `data.path`, plus `path`/`value` carried in graph.js's `io_nodes`.

## Deferred (clean seams, not built)

Content-addressed cache (§6.1), resource-budget semaphore (§6.2), tiered
retention (§6.3), provenance sidecars (§9), version pinning/freeze (§7.3).
