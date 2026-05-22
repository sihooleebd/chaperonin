"""Control-node registry: runtime primitives executed inline by the scheduler.

Unlike @module-decorated tools (which dispatch containers or run on host),
these are *operators that the orchestrator applies*. Keeping them out of
``REGISTRY`` keeps the @module contract clean.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ControlSpec:
    id: str
    label: str
    category: str
    description: str = ""
    inputs: list = field(default_factory=list)   # [{id, type}]
    params: list = field(default_factory=list)   # [{id, type, default, choices?}]
    outputs: list = field(default_factory=list)  # [{id, type}]


_ANY = "*"  # wildcard — propagates whatever's wired in. Resolved at runtime.


CONTROL_KINDS: dict[str, ControlSpec] = {
    "START_FOR": ControlSpec(
        id="START_FOR",
        label="Start For",
        category="control",
        description="Begin a counted loop; reachable nodes up to END_FOR form the body.",
        inputs=[{"id": "count", "type": "Text.Integer"}],
        outputs=[
            {"id": "iter", "type": "Text.Integer"},
            {"id": "gate", "type": _ANY},
        ],
        params=[{"id": "loop_label", "type": "Text.RawString", "default": "loop"}],
    ),
    "END_FOR": ControlSpec(
        id="END_FOR",
        label="End For",
        category="control",
        description="Close a loop; results becomes List<body_out>.",
        inputs=[
            {"id": "paired_start", "type": _ANY},
            {"id": "body_out", "type": _ANY},
        ],
        outputs=[{"id": "results", "type": _ANY}],
        params=[],
    ),
    "SAVE": ControlSpec(
        id="SAVE",
        label="Save Variable",
        category="variable",
        description="Store value into a named variable; passes value through.",
        inputs=[{"id": "value", "type": _ANY}],
        outputs=[{"id": "value", "type": _ANY}],
        params=[{"id": "name", "type": "Text.RawString", "default": "var"}],
    ),
    "GET": ControlSpec(
        id="GET",
        label="Get Variable",
        category="variable",
        description="Read a named variable from the active scope.",
        inputs=[],
        outputs=[{"id": "value", "type": _ANY}],
        params=[{"id": "name", "type": "Text.RawString", "default": "var"}],
    ),
    "IF": ControlSpec(
        id="IF",
        label="If",
        category="control",
        description="Forward value to if_true or if_false based on condition.",
        inputs=[
            {"id": "value", "type": _ANY},
            {"id": "condition", "type": "Text.Bool"},
        ],
        outputs=[
            {"id": "if_true", "type": _ANY},
            {"id": "if_false", "type": _ANY},
        ],
        params=[],
    ),
    "COMPARE": ControlSpec(
        id="COMPARE",
        label="Compare",
        category="utility",
        description="Compare two numbers; result is Text.Bool.",
        inputs=[
            {"id": "a", "type": "Text.Integer | Text.Float | Text.Score"},
            {"id": "b", "type": "Text.Integer | Text.Float | Text.Score"},
        ],
        outputs=[{"id": "result", "type": "Text.Bool"}],
        params=[{"id": "op", "type": "Text.RawString", "default": "lt",
                 "choices": ["lt", "le", "eq", "ne", "ge", "gt"]}],
    ),
    "SELECT": ControlSpec(
        id="SELECT",
        label="Select",
        category="utility",
        description="Pick one item from a list by parallel-list scoring.",
        inputs=[
            {"id": "from", "type": _ANY},  # must be List.T at runtime
            {"id": "by", "type": "List.Text.Float | List.Text.Integer | List.Text.Score"},
        ],
        outputs=[{"id": "value", "type": _ANY}],
        params=[{"id": "mode", "type": "Text.RawString", "default": "min",
                 "choices": ["min", "max", "first", "last"]}],
    ),
}
