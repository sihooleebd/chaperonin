"""Translate a module invocation into a ``docker run`` argv (proposal §6.5).

This is the core of the translation layer's container connection. Pure, no
daemon required — so the exact command this program will issue for your images
is verifiable before you have them.

Convention: host paths are bind-mounted at the *same* path inside the container,
so an argv built from ``ctx.path(handle)`` resolves identically inside. The run
scratch dir is mounted rw; inputs ro.
"""

from __future__ import annotations

from pathlib import Path


def build_docker_command(
    image: str,
    argv: list,
    *,
    workdir: str | Path,
    mounts: list[tuple] = (),
    gpu: bool = False,
    entrypoint: str | None = None,
    env: dict | None = None,
    extra_args: list = (),
    name: str | None = None,
) -> list[str]:
    cmd: list[str] = ["docker", "run", "--rm"]
    if name:
        cmd += ["--name", name]
    if gpu:
        cmd += ["--gpus", "all"]
    if entrypoint:
        cmd += ["--entrypoint", entrypoint]
    for key, value in (env or {}).items():
        cmd += ["-e", f"{key}={value}"]
    cmd += [str(a) for a in extra_args]
    for host, mode in mounts:
        cmd += ["-v", f"{host}:{host}:{mode}"]
    cmd += ["-w", str(workdir)]
    cmd.append(image)
    cmd += [str(a) for a in argv]
    return cmd
