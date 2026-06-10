"""True Firecracker MicroVM execution backend.

Each execution boots a fresh microVM (hardware-virtualized isolation via KVM)
and destroys it afterwards — no shared kernel with the host, unlike
containers. The command travels to the guest through the kernel command line
(``titan_cmd=<base64>``); a tiny init inside the rootfs (see
``firecracker/titan-init.sh``) decodes it, runs it, emits the output between
sentinel markers on the serial console, and powers the VM off. The host
parses the serial log.

Requirements (Linux host):
  * /dev/kvm accessible to this process
  * the ``firecracker`` binary               (env FIRECRACKER_BIN)
  * an uncompressed kernel image (vmlinux)   (env FC_KERNEL_IMAGE)
  * an ext4 rootfs built with build_rootfs.sh (env FC_ROOTFS)

When any requirement is missing, :func:`FirecrackerBackend.available` returns
False and the sandbox manager falls back to the hardened-Docker backend.
"""

import base64
import http.client
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from typing import Any, Dict, Optional

logger = logging.getLogger("TitanSandbox.firecracker")

_OUTPUT_BEGIN = "===TITAN-OUTPUT-BEGIN==="
_EXIT_RE = re.compile(r"===TITAN-EXIT:(-?\d+)===")


class _UnixHTTPConnection(http.client.HTTPConnection):
    """HTTP over the Firecracker API unix socket (stdlib only)."""

    def __init__(self, socket_path: str, timeout: float = 5.0):
        super().__init__("localhost", timeout=timeout)
        self._socket_path = socket_path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._socket_path)
        self.sock = sock


class FirecrackerBackend:
    """Boots one throwaway microVM per command."""

    def __init__(self) -> None:
        self.binary = os.getenv("FIRECRACKER_BIN", shutil.which("firecracker") or "")
        self.kernel = os.getenv("FC_KERNEL_IMAGE", "/var/lib/titan/vmlinux")
        self.rootfs = os.getenv("FC_ROOTFS", "/var/lib/titan/rootfs.ext4")

    def available(self) -> bool:
        checks = {
            "/dev/kvm": os.path.exists("/dev/kvm") and os.access("/dev/kvm", os.R_OK | os.W_OK),
            "firecracker binary": bool(self.binary) and os.path.isfile(self.binary),
            "kernel image": os.path.isfile(self.kernel),
            "rootfs image": os.path.isfile(self.rootfs),
        }
        missing = [name for name, ok in checks.items() if not ok]
        if missing:
            logger.debug("firecracker backend unavailable — missing: %s", ", ".join(missing))
            return False
        return True

    def execute(
        self,
        command: str,
        timeout: int = 10,
        env: Optional[Dict[str, str]] = None,
        vcpus: int = 1,
        mem_mib: int = 128,
    ) -> Dict[str, Any]:
        run_id = uuid.uuid4().hex[:12]
        workdir = tempfile.mkdtemp(prefix=f"titan-fc-{run_id}-")
        api_sock = os.path.join(workdir, "fc.sock")
        serial_log = os.path.join(workdir, "serial.log")
        proc: Optional[subprocess.Popen] = None
        t_start = time.monotonic()

        # env vars ride along in the same base64 payload as the command
        payload = command
        if env:
            exports = "; ".join(
                f"export {k}={_shell_quote(v)}" for k, v in env.items()
            )
            payload = f"{exports}; {command}"
        cmd_b64 = base64.b64encode(payload.encode()).decode()

        try:
            proc = subprocess.Popen(
                [self.binary, "--api-sock", api_sock],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=workdir,
            )
            self._wait_for_socket(api_sock, deadline=2.0)

            boot_args = (
                "console=ttyS0 reboot=k panic=1 pci=off quiet "
                f"init=/sbin/titan-init titan_cmd={cmd_b64}"
            )
            self._api(api_sock, "PUT", "/machine-config", {
                "vcpu_count": vcpus,
                "mem_size_mib": mem_mib,
            })
            self._api(api_sock, "PUT", "/boot-source", {
                "kernel_image_path": self.kernel,
                "boot_args": boot_args,
            })
            self._api(api_sock, "PUT", "/drives/rootfs", {
                "drive_id": "rootfs",
                "path_on_host": self.rootfs,
                "is_root_device": True,
                "is_read_only": True,   # guest writes go to tmpfs only
            })
            self._api(api_sock, "PUT", "/serial", {
                "serial_out_path": serial_log,
            })
            # No /network-interfaces call: the microVM boots with no NIC at
            # all — network isolation is physical absence, not a filter.
            self._api(api_sock, "PUT", "/actions", {"action_type": "InstanceStart"})

            exited = self._wait_for_exit(proc, deadline=timeout)
            elapsed_ms = int((time.monotonic() - t_start) * 1000)

            output, exit_code = self._parse_serial(serial_log)
            if not exited:
                return {
                    "status": "timeout",
                    "output": output,
                    "exit_code": -1,
                    "elapsed_ms": elapsed_ms,
                    "sandbox": "firecracker-microvm",
                }
            return {
                "status": "success" if exit_code == 0 else "failed",
                "output": output,
                "exit_code": exit_code,
                "elapsed_ms": elapsed_ms,
                "sandbox": "firecracker-microvm",
            }

        except Exception as exc:
            elapsed_ms = int((time.monotonic() - t_start) * 1000)
            logger.error("firecracker run %s failed after %dms: %s", run_id, elapsed_ms, exc)
            return {
                "status": "error",
                "error": str(exc),
                "exit_code": -1,
                "elapsed_ms": elapsed_ms,
                "sandbox": "firecracker-microvm",
            }

        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            shutil.rmtree(workdir, ignore_errors=True)

    # ── internals ───────────────────────────────────────────────────────────

    @staticmethod
    def _wait_for_socket(path: str, deadline: float) -> None:
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            if os.path.exists(path):
                return
            time.sleep(0.01)
        raise TimeoutError(f"firecracker API socket {path} never appeared")

    @staticmethod
    def _api(sock_path: str, method: str, path: str, body: Dict[str, Any]) -> None:
        conn = _UnixHTTPConnection(sock_path)
        try:
            conn.request(method, path, body=json.dumps(body),
                         headers={"Content-Type": "application/json"})
            resp = conn.getresponse()
            data = resp.read().decode("utf-8", errors="replace")
            if resp.status >= 300:
                raise RuntimeError(f"firecracker API {method} {path} → {resp.status}: {data}")
        finally:
            conn.close()

    @staticmethod
    def _wait_for_exit(proc: subprocess.Popen, deadline: float) -> bool:
        """True if the VMM exited (guest powered off) within the deadline."""
        try:
            proc.wait(timeout=deadline)
            return True
        except subprocess.TimeoutExpired:
            return False

    @staticmethod
    def _parse_serial(serial_log: str) -> "tuple[str, int]":
        """Extract command output and exit code from the serial console log."""
        try:
            with open(serial_log, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            return "", -1

        begin = text.find(_OUTPUT_BEGIN)
        if begin == -1:
            return "", -1
        tail = text[begin + len(_OUTPUT_BEGIN):]

        m = _EXIT_RE.search(tail)
        if not m:
            return tail.strip(), -1
        return tail[: m.start()].strip(), int(m.group(1))


def _shell_quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"
