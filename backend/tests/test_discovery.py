import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from chaperonin import REGISTRY
from chaperonin.registry import discover


class TestDiscovery(unittest.TestCase):
    def test_importing_package_registers_classes(self):
        REGISTRY.clear()
        tmp = tempfile.mkdtemp()
        pkg = Path(tmp) / "fixture_modules"
        pkg.mkdir()
        (pkg / "__init__.py").write_text("")
        (pkg / "alpha.py").write_text(textwrap.dedent("""
            from chaperonin import module, Input, Output
            from chaperonin.types import Structure, Sequence
            @module(name="ALPHA", label="Alpha", category="converter")
            class Alpha:
                pdb: Input[Structure.PDB]
                fasta: Output[Sequence.FASTA]
                def execute(self, ctx): ...
        """))
        sys.path.insert(0, tmp)
        try:
            found = discover("fixture_modules")
        finally:
            sys.path.remove(tmp)
        self.assertIn("alpha", found)
        self.assertIn("ALPHA", REGISTRY)


if __name__ == "__main__":
    unittest.main()
