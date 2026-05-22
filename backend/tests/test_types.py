import unittest

from chaperonin.types import Structure, Visual, is_compatible


class TestTypes(unittest.TestCase):
    def test_dotted_names_and_terminal(self):
        self.assertEqual(Structure.PDB.name, "Structure.PDB")
        self.assertTrue(Visual.PNG.terminal)
        self.assertFalse(Structure.PDB.terminal)

    def test_compatibility(self):
        self.assertTrue(is_compatible("Structure.PDB", "Structure.PDB"))
        self.assertTrue(is_compatible("Structure.PDB", "Structure"))      # subtype→parent
        self.assertFalse(is_compatible("Structure", "Structure.PDB"))
        self.assertFalse(is_compatible("Structure.PDB", "Sequence.FASTA"))

    def test_union(self):
        self.assertTrue(is_compatible("Sequence.FASTA", "Structure.PDB | Sequence.FASTA"))
        self.assertFalse(is_compatible("Visual.PNG", "Structure.PDB | Sequence.FASTA"))

    def test_empty(self):
        self.assertFalse(is_compatible("", "Structure.PDB"))


if __name__ == "__main__":
    unittest.main()
