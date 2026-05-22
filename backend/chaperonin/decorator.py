"""``@module`` registration + Input/Param/Output markers (proposal §3.4, §5.1, §11).

A module is a plain class that self-describes via type annotations. The decorator
introspects them into a :class:`ModuleSpec` and registers it in ``REGISTRY``. No
separate registry file — adding a tool is "create file, decorate, restart".

Module files must NOT use ``from __future__ import annotations`` so the
annotations stay as live marker objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .types import DataType

REGISTRY: dict[str, "ModuleSpec"] = {}


@dataclass
class _Decl:
    kind: str   # 'input' | 'param' | 'output'
    type: Any   # DataType or str (unions)


class Input:
    def __init__(self, requires: Callable[[dict], bool] | None = None):
        self.requires = requires  # metadata predicate (§4.3); unused in v1

    def __class_getitem__(cls, item) -> _Decl:
        return _Decl("input", item)


class Output:
    def __class_getitem__(cls, item) -> _Decl:
        return _Decl("output", item)


class Param:
    def __init__(self, default: Any = None):
        self.default = default

    def __class_getitem__(cls, item) -> _Decl:
        return _Decl("param", item)


@dataclass
class ModuleSpec:
    id: str
    label: str
    category: str
    description: str = ""
    version: str = "0.1.0"
    resources: dict = field(default_factory=dict)
    retention: str = "standard"
    container: str | None = None
    entrypoint: str | None = None                    # docker --entrypoint override
    docker_args: list = field(default_factory=list)  # extra flags, e.g. --shm-size=8g
    converter: bool = False
    hardware_sensitive: bool = False
    inputs: list = field(default_factory=list)   # [{id, type}]
    params: list = field(default_factory=list)   # [{id, type, default}]
    outputs: list = field(default_factory=list)  # [{id, type}]
    cls: type | None = None


def _type_name(t: Any) -> str:
    return t.name if isinstance(t, DataType) else str(t)


def _collect_annotations(cls: type) -> dict:
    merged: dict = {}
    for klass in reversed(cls.__mro__):
        merged.update(getattr(klass, "__annotations__", {}))
    return merged


def module(
    *,
    name: str,
    label: str | None = None,
    category: str,
    description: str = "",
    version: str = "0.1.0",
    resources: dict | None = None,
    retention: str = "standard",
    container: str | None = None,
    entrypoint: str | None = None,
    docker_args: list | None = None,
    converter: bool = False,
    hardware_sensitive: bool = False,
):
    def wrap(cls: type) -> type:
        inputs, params, outputs = [], [], []
        for fname, decl in _collect_annotations(cls).items():
            if not isinstance(decl, _Decl):
                continue
            tname = _type_name(decl.type)
            if decl.kind == "input":
                inputs.append({"id": fname, "type": tname})
            elif decl.kind == "output":
                outputs.append({"id": fname, "type": tname})
            elif decl.kind == "param":
                attr = cls.__dict__.get(fname)
                default = attr.default if isinstance(attr, Param) else None
                params.append({"id": fname, "type": tname, "default": default})

        spec = ModuleSpec(
            id=name, label=label or name, category=category,
            description=description or (cls.__doc__ or "").strip(),
            version=version, resources=resources or {}, retention=retention,
            container=container, entrypoint=entrypoint, docker_args=docker_args or [],
            converter=converter, hardware_sensitive=hardware_sensitive,
            inputs=inputs, params=params, outputs=outputs, cls=cls,
        )
        REGISTRY[name] = spec
        cls._spec = spec
        return cls

    return wrap
