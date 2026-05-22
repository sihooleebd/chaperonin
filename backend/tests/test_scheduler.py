import tempfile
import threading
import unittest
from pathlib import Path

from chaperonin import module, Input, Output, REGISTRY
from chaperonin.types import Structure
from chaperonin.scheduler import run_pipeline


def _register_copy():
    REGISTRY.clear()

    @module(name="COPY", label="Copy", category="converter")
    class Copy:
        src: Input[Structure.PDB]
        dst: Output[Structure.PDB]
        def execute(self, ctx):
            out = ctx.workdir / "out.pdb"
            out.write_text(Path(ctx.path(self.src)).read_text() + "\nCOPIED")
            ctx.progress(1, 1)
            ctx.publish("dst", out)


def _payload(input_path):
    return {
        "nodes": [{"id": "copy_1", "module_id": "COPY", "params": {},
                   "inputs": ["src"], "outputs": [{"id": "dst", "type": "Structure.PDB"}]}],
        "io_nodes": [{"id": "in1", "type": "input-node", "var_name": "in1",
                      "label": "s", "data_type": "Structure.PDB", "path": input_path},
                     {"id": "out1", "type": "output-node", "var_name": "out1",
                      "label": "r", "data_type": None}],
        "edges": [{"source": "in1", "source_handle": "value", "target": "copy_1",
                   "target_handle": "src", "data_type": "Structure.PDB"},
                  {"source": "copy_1", "source_handle": "dst", "target": "out1",
                   "target_handle": "value", "data_type": "Structure.PDB"}],
        "dsl": "",
    }


class TestScheduler(unittest.TestCase):
    def setUp(self):
        _register_copy()
        self.root = tempfile.mkdtemp()
        self.infile = Path(self.root) / "in.pdb"
        self.infile.write_text("ATOM 1")
        self.events = []

    def types(self):
        return [e["type"] for e in self.events]

    def test_terminal_and_start_count(self):
        run_pipeline(_payload(str(self.infile)), self.events.append, workroot=self.root)
        self.assertEqual(self.types()[0], "pipeline.start")
        self.assertEqual(self.types()[-1], "pipeline.done")
        start = next(e for e in self.events if e["type"] == "pipeline.start")
        self.assertEqual(start["total"], 1)

    def test_lifecycle_and_handle_passing(self):
        run_pipeline(_payload(str(self.infile)), self.events.append, workroot=self.root)
        seq = [e["type"] for e in self.events if e.get("nodeId") == "copy_1"]
        self.assertEqual(seq[0], "node.queued")
        self.assertEqual(seq[1], "node.running")
        self.assertEqual(seq[-1], "node.done")
        done = next(e for e in self.events if e["type"] == "node.done")
        self.assertIn("COPIED", Path(done["outputs"]["dst"]).read_text())

    def test_cancel(self):
        ev = threading.Event(); ev.set()
        run_pipeline(_payload(str(self.infile)), self.events.append, cancel=ev, workroot=self.root)
        self.assertIn("node.cancelled", self.types())
        self.assertEqual(self.types()[-1], "pipeline.done")


if __name__ == "__main__":
    unittest.main()
