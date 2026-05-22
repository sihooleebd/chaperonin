"""Module discovery (proposal §3.4): import the modules package so the
``@module`` decorators populate REGISTRY. Idempotent — reloads already-imported
files so a fresh discover() always rebuilds the registry.
"""

from __future__ import annotations

import importlib
import pkgutil
import sys

from .decorator import REGISTRY  # noqa: F401


def discover(package_name: str = "modules") -> list[str]:
    pkg = importlib.import_module(package_name)
    found: list[str] = []
    for info in pkgutil.iter_modules(pkg.__path__):
        full = f"{package_name}.{info.name}"
        already = full in sys.modules
        mod = importlib.import_module(full)
        if already:
            importlib.reload(mod)
        found.append(info.name)
    return found
