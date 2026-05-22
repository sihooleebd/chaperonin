"""Simulate mode: run any module (incl. containerized) without Docker, so the
whole UI is testable temporarily. Placeholder outputs; a valid PNG for Visual.PNG."""

import tempfile
import unittest
from pathlib import Path

from chaperonin import REGISTRY
from chaperonin.registry import discover
from chaperonin.scheduler import run_pipeline


class TestSimulate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REGISTRY.clear()
        discover("modules")

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.struct = Path(self.root) / "in.pdb"
        self.struct.write_text("ATOM 1\n")

    def _pymol_payload(self):
        return {
            "nodes": [{"id": "pymol_1", "module_id": "PYMOL", "params": {"style": "cartoon"},
                       "inputs": ["structure"],
                       "outputs": [{"id": "rendered", "type": "Visual.PNG"},
                                   {"id": "scene", "type": "Visual.Web3D"}]}],
            "io_nodes": [{"id": "in1", "type": "input-node", "var_name": "in1", "label": "s",
                          "data_type": "Structure.PDB", "path": str(self.struct)}],
            "edges": [{"source": "in1", "source_handle": "value", "target": "pymol_1",
                       "target_handle": "structure", "data_type": "Structure.PDB"}],
            "dsl": "",
        }

    def test_containerized_runs_without_docker(self):
        events = []
        run_pipeline(self._pymol_payload(), events.append, simulate=True, step_delay=0,
                     workroot=self.root)
        types = [e["type"] for e in events]
        self.assertEqual(types[0], "pipeline.start")
        self.assertEqual(types[-1], "pipeline.done")
        self.assertIn("node.progress", types)

    def test_png_is_real_image(self):
        events = []
        run_pipeline(self._pymol_payload(), events.append, simulate=True, step_delay=0,
                     workroot=self.root)
        done = next(e for e in events if e["type"] == "node.done")
        png = Path(done["outputs"]["rendered"])
        self.assertTrue(png.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_all_six_simulate(self):
        nodes = []
        for mid, spec in REGISTRY.items():
            nodes.append({"id": mid.lower(), "module_id": mid, "params": {},
                          "inputs": [i["id"] for i in spec.inputs],
                          "outputs": [{"id": o["id"], "type": o["type"]} for o in spec.outputs]})
        events = []
        run_pipeline({"nodes": nodes, "io_nodes": [], "edges": [], "dsl": ""},
                     events.append, simulate=True, step_delay=0, workroot=self.root)
        done = {e["nodeId"] for e in events if e["type"] == "node.done"}
        self.assertEqual(done, {n["id"] for n in nodes})
        self.assertEqual(events[-1]["type"], "pipeline.done")


if __name__ == "__main__":
    unittest.main()
