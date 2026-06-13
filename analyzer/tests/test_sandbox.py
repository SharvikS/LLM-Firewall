"""
Sandbox isolation tests.

Uses stdlib unittest so it runs with no extra deps:
    PYTHONPATH=.. python -m unittest analyzer.tests.test_sandbox

The Docker-backed cases skip automatically when no daemon is reachable, so the
suite is green on CI runners without Docker while still proving real isolation
(network + read-only rootfs) wherever Docker is available.
"""

import unittest

from analyzer.core import sandbox
from analyzer.core.sandbox import FirecrackerSandboxManager, _connect_docker, _SECCOMP_PROFILE


def _docker_available() -> bool:
    return _connect_docker() is not None


class TestSeccompProfile(unittest.TestCase):
    def test_includes_modern_runc_syscalls(self):
        # Regression guard: these are required for container init under seccomp
        # on current runc/glibc. Their absence silently drops isolation.
        for sc in ("statx", "fstatfs", "clone3", "openat2", "close_range", "newfstatat"):
            self.assertIn(sc, _SECCOMP_PROFILE, f"seccomp allowlist missing {sc}")

    def test_default_action_is_deny(self):
        self.assertIn("SCMP_ACT_ERRNO", _SECCOMP_PROFILE)


class TestBackendSelection(unittest.TestCase):
    def test_simulated_when_no_backend(self):
        m = FirecrackerSandboxManager.__new__(FirecrackerSandboxManager)
        m.firecracker = None
        m.client = None
        res = m.execute_in_sandbox("echo hi")
        self.assertEqual(res["sandbox"], "simulated")
        self.assertEqual(res["exit_code"], 0)


@unittest.skipUnless(_docker_available(), "Docker daemon not reachable")
class TestDockerHardenedIsolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = FirecrackerSandboxManager()

    def test_backend_is_docker_hardened(self):
        res = self.m.execute_in_sandbox("echo titan-ok")
        self.assertEqual(res["sandbox"], "docker-hardened")
        self.assertEqual(res["exit_code"], 0)
        self.assertIn("titan-ok", res["output"])

    def test_network_is_blocked(self):
        # network_mode=none -> outbound name resolution / connect must fail.
        res = self.m.execute_in_sandbox("wget -T3 -qO- http://example.com")
        self.assertNotEqual(res["exit_code"], 0, "network should be unreachable")

    def test_root_filesystem_is_read_only(self):
        res = self.m.execute_in_sandbox("touch /etc/intruder")
        self.assertNotEqual(res["exit_code"], 0, "rootfs should be read-only")


if __name__ == "__main__":
    unittest.main()
