"""REGISTRY + control-node registry -> JSON for the frontend palette."""

from __future__ import annotations

from .decorator import REGISTRY, ModuleSpec
from .control_nodes import CONTROL_KINDS, ControlSpec


def spec_to_json(spec: ModuleSpec) -> dict:
    return {
        "id": spec.id,
        "label": spec.label,
        "category": spec.category,
        "description": spec.description,
        "resources": spec.resources,
        "retention": spec.retention,
        "inputs": spec.inputs,
        "params": spec.params,
        "outputs": spec.outputs,
    }


def control_to_json(spec: ControlSpec) -> dict:
    return {
        "id": spec.id,
        "label": spec.label,
        "category": spec.category,
        "description": spec.description,
        "inputs": spec.inputs,
        "params": spec.params,
        "outputs": spec.outputs,
    }


def registry_to_json() -> dict:
    return {
        "modules": {name: spec_to_json(spec) for name, spec in REGISTRY.items()},
        "control_nodes": {name: control_to_json(spec) for name, spec in CONTROL_KINDS.items()},
    }
