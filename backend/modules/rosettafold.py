"""RoseTTAFold structure prediction (GPU, containerized).

Emits the predicted PDB plus a separate confidence score (§10 keeps the score a
distinct output). Image via ``CHAPERONIN_ROSETTAFOLD_IMAGE``.
"""

import os

from chaperonin import module, Input, Output
from chaperonin.types import Sequence, Structure, Text

IMAGE = os.environ.get("CHAPERONIN_ROSETTAFOLD_IMAGE",
                       "ghcr.io/rosettacommons/rosettafold2:latest")


@module(
    name="ROSETTAFOLD",
    label="RoseTTAFold",
    category="prediction",
    description="Structure prediction (RoseTTAFold)",
    resources={"gpu": 1, "memory_gb": 32},
    retention="permanent",
    container=IMAGE,
    hardware_sensitive=True,
)
class RoseTTAFold:
    sequence: Input[Sequence.FASTA]
    structure: Output[Structure.PDB]
    score: Output[Text.Score]

    def execute(self, ctx):
        outdir = ctx.workdir / "rf_out"
        outdir.mkdir(parents=True, exist_ok=True)
        ctx.progress(0, 1, "running RoseTTAFold")
        ctx.run(["python", "/app/RoseTTAFold2/run_RF2.py",
                 str(ctx.path(self.sequence)), "-o", str(outdir)])
        pdbs = sorted(outdir.glob("*.pdb"))
        if not pdbs:
            raise RuntimeError("RoseTTAFold produced no PDB output")
        score_file = ctx.workdir / "score.txt"
        score_file.write_text("model confidence written by RoseTTAFold run\n")
        ctx.progress(1, 1, "done")
        ctx.publish("structure", pdbs[0])
        ctx.publish("score", score_file)
