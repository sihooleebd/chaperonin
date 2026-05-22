import json
import unittest

from chaperonin import module, Input, Param, Output, REGISTRY
from chaperonin.types import Structure, Text
from chaperonin.introspect import registry_to_json


class TestIntrospect(unittest.TestCase):
    def setUp(self):
        REGISTRY.clear()

        @module(name="RFD", label="RFD", category="design",
                resources={"gpu": 1, "memory_gb": 24}, retention="permanent",
                container="ex/rfd:1")
        class RFD:
            pdb_file: Input[Structure.PDB]
            length: Param[Text.Integer] = Param(default=100)
            designed_pdb: Output[Structure.PDB]
            def execute(self, ctx): ...

        self.payload = registry_to_json()

    def test_shape(self):
        entry = self.payload["modules"]["RFD"]
        self.assertEqual(entry["inputs"], [{"id": "pdb_file", "type": "Structure.PDB"}])
        self.assertEqual(entry["params"], [{"id": "length", "type": "Text.Integer", "default": 100}])
        self.assertEqual(entry["outputs"], [{"id": "designed_pdb", "type": "Structure.PDB"}])

    def test_no_backend_only_fields(self):
        entry = self.payload["modules"]["RFD"]
        self.assertNotIn("cls", entry)
        self.assertNotIn("container", entry)

    def test_json_serializable(self):
        json.dumps(self.payload)


if __name__ == "__main__":
    unittest.main()
