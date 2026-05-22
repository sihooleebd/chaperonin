"""RFdiffusion: backbone design via diffusion (CPU container).

Local CPU execution: dispatches the official ``rosettacommons/rfdiffusion``
Docker image with ``inference.device=cpu``, forced to ``linux/amd64`` so it
runs on hosts without an NVIDIA GPU. Slow under arm64 emulation (expect
30 min – 3 hours per design) but produces real designs without a GPU host.

Override the image with ``CHAPERONIN_RFDIFFUSION_IMAGE``.
"""

import os

from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text

IMAGE = os.environ.get(
    "CHAPERONIN_RFDIFFUSION_IMAGE",
    "rosettacommons/rfdiffusion:latest",
)


@module(
    name="RFDIFFUSION",
    label="RFDiffusion",
    category="design",
    description="Backbone design via diffusion (CPU; slow under arm64 emulation)",
    version="2.0.0",
    resources={"gpu": 0, "memory_gb": 16},
    retention="permanent",
    container=IMAGE,
    docker_args=["--platform", "linux/amd64", "--shm-size=2g"],
    hardware_sensitive=True,
)
class RFDiffusion:
    pdb_file: Input[Structure.PDB]
    contigs: Param[Text.RawString] = Param(default="50-100")
    hotspot_res: Param[Text.RawString] = Param(default="")
    num_designs: Param[Text.Integer] = Param(default=1)
    designed_pdb: Output[Structure.PDB]

    def execute(self, ctx):
        prefix = ctx.workdir / "designed"
        contigs = str(self.contigs.value if self.contigs.value is not None else "50-100").strip()
        hotspot = str(self.hotspot_res.value if self.hotspot_res.value is not None else "").strip()
        n = max(1, int(self.num_designs.value if self.num_designs.value is not None else 1))

        # The image's ENTRYPOINT is already
        #   /app/RFdiffusion/.venv/bin/python /app/RFdiffusion/scripts/run_inference.py
        # so we pass only hydra overrides as argv. CUDA-vs-CPU is auto-detected
        # by PyTorch — there's no inference.device key in this image's config.
        argv = [
            f"inference.input_pdb={ctx.path(self.pdb_file)}",
            f"inference.output_prefix={prefix}",
            f"contigmap.contigs=[{contigs}]",
            f"inference.num_designs={n}",
        ]
        if hotspot:
            argv.append(f"ppi.hotspot_res=[{hotspot}]")

        ctx.log(
            "Running RFdiffusion on CPU under linux/amd64 emulation. "
            "Expect 30 min – 3 hours per design on Apple Silicon."
        )
        ctx.progress(0, n, "starting RFdiffusion")
        ctx.run(argv)

        # RFdiffusion writes <prefix>_<i>.pdb for i in 0..n-1; publish the first.
        out = ctx.workdir / "designed_0.pdb"
        if not out.is_file():
            # Fall back: any designed_*.pdb that landed in the workdir.
            candidates = sorted(ctx.workdir.glob("designed_*.pdb"))
            if not candidates:
                raise RuntimeError("RFdiffusion produced no designed_*.pdb output")
            out = candidates[0]
        ctx.progress(n, n, "done")
        ctx.publish("designed_pdb", out, metadata={"contigs": contigs, "num_designs": n})
