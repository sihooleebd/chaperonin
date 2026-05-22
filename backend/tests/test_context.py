"""ExecutionContext container-mode translation: it builds the docker command,
logs it, and gives a clear error when docker is missing — all without a daemon."""

import subprocess
import unittest
from pathlib import Path

from chaperonin.context import ExecutionContext


class _FakeProc:
    def __init__(self):
        self.stdout = iter(["line one\n", "line two\n"])
        self.returncode = 0
    def wait(self):
        return 0


class TestContainerRun(unittest.TestCase):
    def setUp(self, tmp="/tmp/chap_ctx_test"):
        Path(tmp).mkdir(parents=True, exist_ok=True)
        self.events = []
        self.ctx = ExecutionContext(
            "n1", tmp, self.events.append, container="img:1", gpu=1,
            mounts=[(Path(tmp), "rw")], entrypoint="/bin/run.sh",
            docker_args=["--shm-size=8g"],
        )

    def test_build_command_includes_image_specifics(self):
        cmd = self.ctx.build_command(["python", "run.py"])
        self.assertEqual(cmd[:3], ["docker", "run", "--rm"])
        self.assertIn("--gpus", cmd)
        self.assertIn("--entrypoint", cmd)
        self.assertIn("--shm-size=8g", cmd)
        self.assertEqual(cmd[cmd.index("img:1"):], ["img:1", "python", "run.py"])

    def test_run_logs_the_command_and_streams_output(self):
        orig = subprocess.Popen
        subprocess.Popen = lambda *a, **k: _FakeProc()
        try:
            self.ctx.run(["python", "run.py"])
        finally:
            subprocess.Popen = orig
        lines = [e["line"] for e in self.events if e["type"] == "node.log"]
        self.assertTrue(any(l.startswith("$ docker run --rm") for l in lines))
        self.assertIn("line one", lines)

    def test_missing_docker_gives_clear_error(self):
        orig = subprocess.Popen
        def boom(*a, **k):
            raise FileNotFoundError("docker")
        subprocess.Popen = boom
        try:
            with self.assertRaises(RuntimeError) as cm:
                self.ctx.run(["python", "run.py"])
            self.assertIn("CHAPERONIN_SIMULATE=1", str(cm.exception))
        finally:
            subprocess.Popen = orig


if __name__ == "__main__":
    unittest.main()
