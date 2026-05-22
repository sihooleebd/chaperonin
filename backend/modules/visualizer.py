"""Visualizer: terminal sink node. Receives a PNG, PDB, or 3D scene and
surfaces it inline in the canvas. No outputs — display only.

The frontend's VisualizerNode component reads the URL from the upstream
edge's source-node outputs (resolved in App.jsx's node.done handler) and
renders it inside the node itself.
"""

from chaperonin import module, Input
from chaperonin.types import Structure, Visual


@module(
    name="VISUALIZER",
    label="Visualizer",
    category="visualization",
    description="Render a PNG, PDB, or 3D scene inline in the canvas (sink)",
    version="3.0.0",
    resources={"gpu": 0, "memory_gb": 1},
    retention="ephemeral",
    converter=True,
)
class Visualizer:
    value: Input["Visual.PNG | Visual.Web3D | Structure.PDB"]

    def execute(self, ctx):
        if self.value is None or self.value.path is None:
            raise RuntimeError("Visualizer received no value to display")
        ctx.log(f"display: {self.value.path}")
        ctx.progress(1, 1, "ready")
