"""AlphaFold structure prediction from sequence via ColabFold (local CPU, no per-run internet).

Uses ColabFold in single-sequence mode: skips remote MSA lookup and runs the
AlphaFold2 network with ESM-2 embeddings instead. Model weights (~2 GB) are
downloaded on first run and cached in the chaperonin data volume at
/root/.chaperonin/.cache/colabfold — subsequent runs are fully offline.

Quality is comparable to ESMFold (lower than MSA-backed AlphaFold2 for
multi-domain or evolutionarily sparse proteins, but good for most use cases).

Image override: CHAPERONIN_ALPHAFOLD_IMAGE
"""

import os

from chaperonin import module, Input, Output
from chaperonin.types import Sequence, Structure, Text

IMAGE = os.environ.get("CHAPERONIN_ALPHAFOLD_IMAGE", "ghcr.io/sokrypton/colabfold:1.6.1-cuda12")

# Cache dir inside the persistent chaperonin-data volume so weights survive
# container restarts. Passed as XDG_CACHE_HOME to the child container.
_CACHE_ROOT = os.environ.get("CHAPERONIN_DATA_ROOT", "/root/.chaperonin")
_CACHE_ENV  = f"XDG_CACHE_HOME={_CACHE_ROOT}/.cache"


@module(
    name="ALPHAFOLD",
    label="AlphaFold",
    category="prediction",
    description="Structure prediction from sequence (local CPU, no internet after first run)",
    resources={"gpu": 0, "memory_gb": 16},
    retention="permanent",
    container=IMAGE,
    hardware_sensitive=False,
    docker_args=["-e", _CACHE_ENV],
)
class AlphaFold:
    sequence:  Input[Sequence.FASTA]
    structure: Output[Structure.PDB]
    pae_json:  Output[Text.RawString]

    def execute(self, ctx):
        outdir = ctx.workdir / "af_out"
        outdir.mkdir(parents=True, exist_ok=True)
        ctx.log(
            "Running ColabFold in single-sequence mode (no MSA, no internet after first run). "
            "CPU fallback is automatic when no GPU is detected."
        )
        ctx.progress(0, 1, "running ColabFold (single-sequence)")
        ctx.run([
            "colabfold_batch",
            "--msa-mode", "single_sequence",
            str(ctx.path(self.sequence)),
            str(outdir),
        ])
        ranked = sorted(outdir.glob("*_rank_001*.pdb")) or sorted(outdir.glob("*.pdb"))
        if not ranked:
            raise RuntimeError("ColabFold produced no PDB output")
        pae_files = (
            sorted(outdir.glob("*_predicted_aligned_error_v1.json"))
            or sorted(outdir.glob("*.json"))
        )
        ctx.progress(1, 1, "done")
        ctx.publish("structure", ranked[0], metadata={"source": "colabfold_single_seq"})
        if pae_files:
            ctx.publish("pae_json", pae_files[0])
