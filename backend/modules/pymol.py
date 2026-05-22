"""PyMOL: headless molecular render -> PNG (+ a Web3D scene). Containerized (§6.5).

Point at your image via ``CHAPERONIN_PYMOL_IMAGE`` or edit ``IMAGE`` — that one
line is the only edit needed.
"""

import os

from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text, Visual

IMAGE = os.environ.get("CHAPERONIN_PYMOL_IMAGE", "pymol-open-source:latest")


@module(
    name="PYMOL",
    label="PyMOL",
    category="visualization",
    description="Molecular visualization (PNG render + PDB scene)",
    resources={"gpu": 0, "memory_gb": 4},
    retention="ephemeral",
    container=IMAGE,
)
class PyMOL:
    structure: Input[Structure.PDB]
    style: Param[Text.RawString] = Param(default="cartoon")
    rendered: Output[Visual.PNG]
    scene: Output[Structure.PDB]

    def execute(self, ctx):
        pdb = ctx.path(self.structure)
        style = str(self.style.value or "cartoon")
        rendered = ctx.workdir / "render.png"
        scene = ctx.workdir / "scene.pdb"
        ctx.progress(0, 1, "rendering")
        ctx.run([
            "pymol", "-cq", str(pdb), "-d",
            f"hide everything; show {style}; bg_color white; orient; "
            f"ray 1200,900; png {rendered}, dpi=150; save {scene}",
        ])
        ctx.progress(1, 1, "done")
        ctx.publish("rendered", rendered)
        ctx.publish("scene", scene)
