"""Rosetta Relax: energy minimization between design and scoring (CPU, container).

Requires Rosetta (academic licence). Image via ``CHAPERONIN_ROSETTA_IMAGE``.
"""

import os
from pathlib import Path

from chaperonin import module, Input, Param, Output
from chaperonin.types import Structure, Text

IMAGE = os.environ.get("CHAPERONIN_ROSETTA_IMAGE", "rosettacommons/rosetta:latest")


def _parse_total_score(pdb_path: Path):
    """Pull the ``pose`` row's total score from Rosetta's energies table
    appended to the relaxed PDB. Returns ``float`` or ``None``."""
    try:
        text = pdb_path.read_text()
    except OSError:
        return None
    in_table = False
    for line in text.splitlines():
        if line.startswith("#BEGIN_POSE_ENERGIES_TABLE"):
            in_table = True
            continue
        if line.startswith("#END_POSE_ENERGIES_TABLE"):
            break
        if in_table and line.startswith("pose"):
            parts = line.split()
            try:
                return float(parts[-1])
            except (ValueError, IndexError):
                return None
    return None

_STANDARD_AA = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
}


def _strip_to_protein(src_text: str) -> str:
    """Keep only standard-amino-acid ATOM records plus TER/END markers.

    Rosetta's PDB importer trips on covalently attached ligands (ETA, MPD,
    acetyl caps) and waters even with -ignore_unrecognized_res; the safe path
    is to hand it pure protein.
    """
    kept = []
    for line in src_text.splitlines():
        if line.startswith("ATOM") and len(line) >= 20:
            if line[17:20].strip() in _STANDARD_AA:
                kept.append(line)
        elif line.startswith(("TER", "END")):
            kept.append(line)
    if not any(l.endswith("END") or l.startswith("END") for l in kept):
        kept.append("END")
    return "\n".join(kept) + "\n"


@module(
    name="ROSETTA_RELAX",
    label="Rosetta Relax",
    category="refinement",
    description="Energy minimization",
    resources={"gpu": 0, "memory_gb": 8, "cpu_cores": 8},
    retention="standard",
    container=IMAGE,
)
class RosettaRelax:
    structure: Input[Structure.PDB]
    nstruct: Param[Text.Integer] = Param(default=10)
    relaxed: Output[Structure.PDB]
    score: Output[Text.Score]

    def execute(self, ctx):
        src = ctx.path(self.structure)
        cleaned = ctx.workdir / "input_cleaned.pdb"
        cleaned.write_text(_strip_to_protein(src.read_text()))
        kept = sum(1 for l in cleaned.read_text().splitlines() if l.startswith("ATOM"))
        ctx.log(f"prepared {kept} standard-AA atoms for relax")

        ctx.progress(0, self.nstruct.value, "relaxing")
        ctx.run([
            "relax.default.linuxgccrelease",
            "-s", str(cleaned),
            "-nstruct", str(self.nstruct.value),
            "-out:path:all", str(ctx.workdir),
            "-out:prefix", "relaxed_",
            "-ignore_unrecognized_res", "true",
            "-ignore_zero_occupancy", "false",
        ])
        relaxed = sorted(ctx.workdir.glob("relaxed_*.pdb"))
        if not relaxed:
            raise RuntimeError("Rosetta relax produced no PDB output")
        ctx.progress(1, 1, "done")
        ctx.publish("relaxed", relaxed[0])
        score = _parse_total_score(relaxed[0])
        if score is not None:
            ctx.log(f"total_score = {score}")
            ctx.publish("score", value=score)
        else:
            ctx.log("warning: could not parse total_score from relaxed PDB")
