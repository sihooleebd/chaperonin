"""PDB -> FASTA: extract the chain sequence from a structure.

The proposal's "trivial converter; first end-to-end test" (§10). No external
program, so it runs on the host (no ``container=``) and is fully testable now.
"""

from chaperonin import module, Input, Output
from chaperonin.types import Structure, Sequence

_THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


@module(
    name="PDB_TO_FASTA",
    label="PDB → FASTA",
    category="converter",
    description="Extract sequence from structure",
    resources={"gpu": 0, "memory_gb": 1},
    retention="ephemeral",
    converter=True,
)
class PdbToFasta:
    pdb: Input[Structure.PDB]
    fasta: Output[Sequence.FASTA]

    def execute(self, ctx):
        pdb_path = ctx.path(self.pdb)
        chains: dict[str, list[str]] = {}
        seen: set[tuple[str, str]] = set()
        for line in pdb_path.read_text().splitlines():
            if not line.startswith("ATOM"):
                continue
            resn = line[17:20].strip()
            chain = line[21] if len(line) > 21 else "A"
            resseq = line[22:26].strip()
            key = (chain, resseq)
            if key in seen:
                continue
            seen.add(key)
            chains.setdefault(chain, []).append(_THREE_TO_ONE.get(resn, "X"))

        out = ctx.workdir / "sequence.fasta"
        lines = []
        for chain, residues in chains.items():
            lines.append(f">chain_{chain}")
            lines.append("".join(residues))
        out.write_text("\n".join(lines) + "\n")
        ctx.log(f"extracted {sum(len(r) for r in chains.values())} residues "
                f"across {len(chains)} chain(s)")
        ctx.progress(1, 1, "done")
        ctx.publish("fasta", out, metadata={"chains": len(chains)})
