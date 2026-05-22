"""The translation step: module + handles -> a `docker run` argv. Pure and fully
testable without a Docker daemon — verify the command before you have the image."""

import unittest

from chaperonin.dockercmd import build_docker_command


class TestBuildDockerCommand(unittest.TestCase):
    def test_minimal(self):
        self.assertEqual(
            build_docker_command("img:1", ["echo", "hi"], workdir="/w"),
            ["docker", "run", "--rm", "-w", "/w", "img:1", "echo", "hi"])

    def test_gpu(self):
        cmd = build_docker_command("img:1", ["x"], workdir="/w", gpu=True)
        self.assertEqual(cmd[cmd.index("--gpus") + 1], "all")

    def test_mounts(self):
        cmd = build_docker_command("img:1", ["x"], workdir="/w",
                                   mounts=[("/runs", "rw"), ("/in", "ro")])
        self.assertIn("/runs:/runs:rw", cmd)
        self.assertIn("/in:/in:ro", cmd)

    def test_entrypoint(self):
        cmd = build_docker_command("img:1", ["a"], workdir="/w", entrypoint="/bin/run.sh")
        self.assertEqual(cmd[cmd.index("--entrypoint") + 1], "/bin/run.sh")

    def test_env_and_extra_args(self):
        cmd = build_docker_command("img:1", ["x"], workdir="/w",
                                   env={"SEED": "1"}, extra_args=["--shm-size=8g"])
        self.assertIn("SEED=1", cmd)
        self.assertIn("--shm-size=8g", cmd)

    def test_image_then_argv_last(self):
        cmd = build_docker_command("img:1", ["run", "--flag"], workdir="/w", gpu=True)
        self.assertEqual(cmd[cmd.index("img:1"):], ["img:1", "run", "--flag"])

    def test_argv_stringified(self):
        cmd = build_docker_command("img:1", ["n", 50], workdir="/w")
        self.assertEqual(cmd[-2:], ["n", "50"])


if __name__ == "__main__":
    unittest.main()
