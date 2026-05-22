"""The Chaperonin type system (proposal §4).

Hierarchical, dotted types: ``Structure.PDB`` is a subtype of ``Structure``.
A wire is valid iff the source's output type satisfies the destination's input
type (covariant). Union inputs use ``|``. Single source of truth for the type
hierarchy; the frontend keeps only a colour lookup.

The ``List.X`` namespace is the elementwise lift: ``List.A`` is compatible
with ``List.B`` iff ``A`` is compatible with ``B``. Used by the control-flow
END_FOR / SELECT primitives.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DataType:
    name: str
    terminal: bool = False  # render/leaf types (Visual.*) — proposal §4.4

    def __str__(self) -> str:
        return self.name

    def __or__(self, other) -> str:        # Input[Structure.PDB | Sequence.FASTA]
        return f"{self.name} | {other}"

    def __ror__(self, other) -> str:
        return f"{other} | {self.name}"


class Structure:
    PDB = DataType("Structure.PDB")
    mmCIF = DataType("Structure.mmCIF")


class Sequence:
    FASTA = DataType("Sequence.FASTA")
    FASTQ = DataType("Sequence.FASTQ")


class Visual:
    PNG = DataType("Visual.PNG", terminal=True)
    Web3D = DataType("Visual.Web3D", terminal=True)


class Text:
    RawString = DataType("Text.RawString")
    Integer = DataType("Text.Integer")
    Float = DataType("Text.Float")
    Score = DataType("Text.Score")
    Bool = DataType("Text.Bool")


# List namespace — elementwise lift of the scalar hierarchy.
class _ListStructure:
    PDB = DataType("List.Structure.PDB")
    mmCIF = DataType("List.Structure.mmCIF")


class _ListSequence:
    FASTA = DataType("List.Sequence.FASTA")
    FASTQ = DataType("List.Sequence.FASTQ")


class _ListText:
    RawString = DataType("List.Text.RawString")
    Integer = DataType("List.Text.Integer")
    Float = DataType("List.Text.Float")
    Score = DataType("List.Text.Score")
    Bool = DataType("List.Text.Bool")


class _ListVisual:
    PNG = DataType("List.Visual.PNG")
    Web3D = DataType("List.Visual.Web3D")


class List:
    Structure = _ListStructure
    Sequence = _ListSequence
    Text = _ListText
    Visual = _ListVisual


def is_compatible(output_type: str, input_type: str) -> bool:
    """True if a value of ``output_type`` may feed an input declared ``input_type``.

    Rules:
      * exact match
      * subtype → parent (dotted prefix)
      * union (``|`` in input)
      * List elementwise lift: ``List.X`` matches ``List.Y`` iff ``X`` matches ``Y``
      * ``*`` matches anything (wildcard, used by control primitives)
    """
    if not output_type or not input_type:
        return False
    if output_type == "*" or input_type == "*":
        return True
    if output_type == input_type:
        return True
    if "|" in input_type:
        return any(is_compatible(output_type, p.strip()) for p in input_type.split("|"))
    out_is_list = output_type.startswith("List.")
    in_is_list = input_type.startswith("List.")
    if out_is_list != in_is_list:
        return False
    if out_is_list and in_is_list:
        return is_compatible(output_type[5:], input_type[5:])
    if output_type.startswith(input_type + "."):
        return True
    return False
