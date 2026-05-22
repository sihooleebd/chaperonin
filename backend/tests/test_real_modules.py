"""Contract test: the six module files must match the partner frontend's
modules.js exactly (so graph wiring resolves), and the host-runnable converter
runs end-to-end."""

import tempfile
import unittest
from pathlib import Path

from chaperonin import REGISTRY
from chaperonin.registry import discover
from chaperonin.introspect import registry_to_json
from chaperonin.scheduler import run_pipeline

EXPECTED = {
    "RFDIFFUSION": {"category": "design", "retention": "permanent",
        "inputs": [{"id": "pdb_file", "type": "Structure.PDB"}],
        "params": [{"id": "contigs", "type": "Text.RawString", "default": "50-100"},
                   {"id": "hotspot_res", "type": "Text.RawString", "default": ""},
                   {"id": "num_designs", "type": "Text.Integer", "default": 1}],
        "outputs": [{"id": "designed_pdb", "type": "Structure.PDB"}]},
    "ALPHAFOLD": {"category": "prediction", "retention": "permanent",
        "inputs": [{"id": "sequence", "type": "Sequence.FASTA"}], "params": [],
        "outputs": [{"id": "structure", "type": "Structure.PDB"}]},
    "ROSETTAFOLD": {"category": "prediction", "retention": "permanent",
        "inputs": [{"id": "sequence", "type": "Sequence.FASTA"}], "params": [],
        "outputs": [{"id": "structure", "type": "Structure.PDB"},
                    {"id": "score", "type": "Text.Score"}]},
    "ROSETTA_RELAX": {"category": "refinement", "retention": "standard",
        "inputs": [{"id": "structure", "type": "Structure.PDB"}],
        "params": [{"id": "nstruct", "type": "Text.Integer", "default": 10}],
        "outputs": [{"id": "relaxed", "type": "Structure.PDB"},
                    {"id": "score", "type": "Text.Score"}]},
    "PYMOL": {"category": "visualization", "retention": "ephemeral",
        "inputs": [{"id": "structure", "type": "Structure.PDB"}],
        "params": [{"id": "style", "type": "Text.RawString", "default": "cartoon"}],
        "outputs": [{"id": "rendered", "type": "Visual.PNG"},
                    {"id": "scene", "type": "Structure.PDB"}]},
    "PDB_TO_FASTA": {"category": "converter", "retention": "ephemeral",
        "inputs": [{"id": "pdb", "type": "Structure.PDB"}], "params": [],
        "outputs": [{"id": "fasta", "type": "Sequence.FASTA"}]},
    "VISUALIZER": {"category": "visualization", "retention": "ephemeral",
        "inputs": [{"id": "value",
                    "type": "Visual.PNG | Visual.Web3D | Structure.PDB"}],
        "params": [],
        "outputs": []},
}


class TestRealModules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REGISTRY.clear()
        discover("modules")
        cls.mods = registry_to_json()["modules"]

    def test_all_six(self):
        self.assertEqual(set(self.mods), set(EXPECTED))

    def test_shapes_match_frontend(self):
        for mid, want in EXPECTED.items():
            got = self.mods[mid]
            for key in ("category", "retention", "inputs", "params", "outputs"):
                self.assertEqual(got[key], want[key], f"{mid}.{key}")

    def test_containerized_declare_image(self):
        for mid in ("RFDIFFUSION", "ALPHAFOLD", "ROSETTAFOLD", "ROSETTA_RELAX", "PYMOL"):
            self.assertTrue(REGISTRY[mid].container, mid)

    def test_pdb_to_fasta_runs_on_host(self):
        root = tempfile.mkdtemp()
        pdb = Path(root) / "tiny.pdb"
        pdb.write_text("ATOM      1  CA  ALA A   1\nATOM      2  CA  GLY A   2\n"
                       "ATOM      3  CA  SER A   3\n")
        payload = {
            "nodes": [{"id": "p2f", "module_id": "PDB_TO_FASTA", "params": {},
                       "inputs": ["pdb"], "outputs": [{"id": "fasta", "type": "Sequence.FASTA"}]}],
            "io_nodes": [{"id": "in1", "type": "input-node", "var_name": "in1", "label": "s",
                          "data_type": "Structure.PDB", "path": str(pdb)}],
            "edges": [{"source": "in1", "source_handle": "value", "target": "p2f",
                       "target_handle": "pdb", "data_type": "Structure.PDB"}],
            "dsl": "",
        }
        events = []
        run_pipeline(payload, events.append, workroot=root)
        self.assertEqual(events[-1]["type"], "pipeline.done")
        done = next(e for e in events if e["type"] == "node.done")
        self.assertIn("AGS", Path(done["outputs"]["fasta"]).read_text())


if __name__ == "__main__":
    unittest.main()
