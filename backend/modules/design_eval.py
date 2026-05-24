"""Evaluate protein design quality: mean pLDDT and interface PAE.

pLDDT is read from the B-factor column of the PDB (AlphaFold stores it there).
iPAE is the mean off-diagonal block of the PAE matrix from the AlphaFold JSON.
"""

import json

from chaperonin import module, Input, Output
from chaperonin.types import Structure, Text


@module(
    name="DESIGN_EVAL",
    label="Design Evaluator",
    category="prediction",
    description="Compute mean pLDDT and interface PAE from AlphaFold outputs",
    resources={"gpu": 0, "memory_gb": 4},
    retention="ephemeral",
)
class DesignEval:
    structure: Input[Structure.PDB]
    pae_json:  Input[Text.RawString]
    plddt: Output[Text.Score]
    ipae:  Output[Text.Score]

    def execute(self, ctx):
        ctx.progress(0, 2, "computing pLDDT")
        bfactors = []
        for line in ctx.path(self.structure).read_text().splitlines():
            if line.startswith(("ATOM", "HETATM")):
                try:
                    bfactors.append(float(line[60:66]))
                except ValueError:
                    pass
        if not bfactors:
            raise RuntimeError("No B-factor data found in PDB")
        mean_plddt = sum(bfactors) / len(bfactors)

        ctx.progress(1, 2, "computing iPAE")
        pae_data = json.loads(ctx.path(self.pae_json).read_text())
        pae = pae_data.get("pae") or pae_data.get("predicted_aligned_error")
        if pae is None:
            raise RuntimeError(
                "PAE matrix not found in JSON (expected key 'pae' or 'predicted_aligned_error')"
            )
        chain_index = pae_data.get("chain_index") or pae_data.get("token_chain_ids")
        n = len(pae)
        if chain_index and len(chain_index) == n:
            # Average over inter-chain residue pairs only
            ipae_vals = [
                pae[i][j]
                for i in range(n)
                for j in range(n)
                if chain_index[i] != chain_index[j]
            ]
        else:
            # Single chain or no chain info — average off-diagonal elements
            ipae_vals = [pae[i][j] for i in range(n) for j in range(n) if i != j]
        mean_ipae = sum(ipae_vals) / len(ipae_vals) if ipae_vals else 0.0

        plddt_file = ctx.workdir / "plddt.txt"
        ipae_file  = ctx.workdir / "ipae.txt"
        plddt_file.write_text(f"{mean_plddt:.4f}\n")
        ipae_file.write_text(f"{mean_ipae:.4f}\n")

        ctx.progress(2, 2, "done")
        ctx.publish("plddt", plddt_file)
        ctx.publish("ipae",  ipae_file)
