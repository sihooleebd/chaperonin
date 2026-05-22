"""AlphaFold structure prediction from sequence (GPU, containerized).

Defaults to a ColabFold image (remote MSA, no 2.5 TB local DBs). Image via
``CHAPERONIN_ALPHAFOLD_IMAGE``. Rendering is downstream PyMOL (§10).
"""

import os

from chaperonin import module, Input, Output
from chaperonin.types import Sequence, Structure

IMAGE = os.environ.get("CHAPERONIN_ALPHAFOLD_IMAGE", "ghcr.io/sokrypton/colabfold:latest")


@module(
    name="ALPHAFOLD",
    label="AlphaFold",
    category="prediction",
    description="Structure prediction from sequence",
    resources={"gpu": 1, "memory_gb": 40},
    retention="permanent",
    container=IMAGE,
    hardware_sensitive=True,
)
class AlphaFold:
    sequence: Input[Sequence.FASTA]
    structure: Output[Structure.PDB]

    def execute(self, ctx):
        outdir = ctx.workdir / "af_out"
        outdir.mkdir(parents=True, exist_ok=True)
        ctx.progress(0, 1, "running ColabFold")
        ctx.run(["colabfold_batch", str(ctx.path(self.sequence)), str(outdir)])
        ranked = sorted(outdir.glob("*_rank_001*.pdb")) or sorted(outdir.glob("*.pdb"))
        if not ranked:
            raise RuntimeError("AlphaFold/ColabFold produced no PDB output")
        ctx.progress(1, 1, "done")
        ctx.publish("structure", ranked[0], metadata={"source": "colabfold"})
