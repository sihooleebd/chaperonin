import unittest

from chaperonin import module, Input, Param, Output, REGISTRY
from chaperonin.types import Structure, Text


class TestDecorator(unittest.TestCase):
    def setUp(self):
        REGISTRY.clear()

        @module(name="TOY", label="Toy", category="design",
                resources={"gpu": 1, "memory_gb": 8}, retention="permanent",
                container="ex/toy:1", entrypoint="/bin/run.sh",
                docker_args=["--shm-size=8g"])
        class Toy:
            pdb_file: Input[Structure.PDB]
            length: Param[Text.Integer] = Param(default=100)
            out_pdb: Output[Structure.PDB]
            def execute(self, ctx): ...

        self.spec = REGISTRY["TOY"]

    def test_metadata(self):
        self.assertEqual(self.spec.container, "ex/toy:1")
        self.assertEqual(self.spec.entrypoint, "/bin/run.sh")
        self.assertEqual(self.spec.docker_args, ["--shm-size=8g"])
        self.assertEqual(self.spec.resources["gpu"], 1)

    def test_inputs_outputs(self):
        self.assertEqual(self.spec.inputs, [{"id": "pdb_file", "type": "Structure.PDB"}])
        self.assertEqual(self.spec.outputs, [{"id": "out_pdb", "type": "Structure.PDB"}])

    def test_param_default(self):
        self.assertEqual(self.spec.params, [{"id": "length", "type": "Text.Integer", "default": 100}])


if __name__ == "__main__":
    unittest.main()
