import json
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("TitanSandbox")

# Seccomp profile: allowlist the syscalls an alpine script runner needs.
# Any syscall not in this list raises EPERM, blocking privilege escalation,
# raw socket creation, and kernel module loading.
_SECCOMP_PROFILE = json.dumps({
    "defaultAction": "SCMP_ACT_ERRNO",
    "syscalls": [{
        "names": [
            "read", "write", "open", "openat", "close", "stat", "fstat",
            "lstat", "poll", "lseek", "mmap", "mprotect", "munmap", "brk",
            "rt_sigaction", "rt_sigprocmask", "rt_sigreturn", "ioctl",
            "access", "pipe", "select", "sched_yield", "mremap", "msync",
            "mincore", "madvise", "dup", "dup2", "nanosleep", "getpid",
            "clone", "fork", "vfork", "execve", "exit", "wait4", "kill",
            "uname", "fcntl", "flock", "fsync", "fdatasync", "truncate",
            "ftruncate", "getdents", "getcwd", "chdir", "rename", "mkdir",
            "rmdir", "creat", "link", "unlink", "symlink", "readlink",
            "chmod", "fchmod", "chown", "fchown", "lchown", "umask",
            "gettimeofday", "getrlimit", "getrusage", "sysinfo", "times",
            "getuid", "getgid", "geteuid", "getegid", "getgroups",
            "exit_group", "tgkill", "futex", "set_tid_address",
            "clock_gettime", "clock_nanosleep", "epoll_create", "epoll_ctl",
            "epoll_wait", "epoll_pwait", "getdents64", "pread64", "pwrite64",
            "readv", "writev", "arch_prctl", "prctl", "capget",
        ],
        "action": "SCMP_ACT_ALLOW",
    }],
})


class FirecrackerSandboxManager:
    """
    Isolated execution for agent tool calls, strongest backend first:

    1. firecracker-microvm — true Firecracker microVMs (hardware-virtualized
       KVM isolation, no NIC, read-only rootfs). Active when /dev/kvm, the
       firecracker binary, a kernel image and a rootfs are present — see
       core/firecracker_backend.py and core/firecracker/build_rootfs.sh.
    2. docker-hardened — containers with network_mode=none, read-only rootfs,
       all capabilities dropped, seccomp syscall allowlist, no-new-privileges,
       128 MB no-swap memory cap, 50-PID limit, noexec tmpfs.
    3. simulated — no execution at all (local dev without Docker/KVM).

    The backend in use is reported in every result's "sandbox" field.
    """

    def __init__(self) -> None:
        self.firecracker = None
        try:
            from analyzer.core.firecracker_backend import FirecrackerBackend
            fc = FirecrackerBackend()
            if fc.available():
                self.firecracker = fc
                logger.info("Sandbox using Firecracker microVMs (KVM hardware isolation)")
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("Firecracker backend probe failed: %s", exc)

        self.client = None
        if self.firecracker is None:
            try:
                import docker  # type: ignore
                self.client = docker.from_env()
                logger.info("Sandbox connected to Docker API (hardened-container isolation active)")
            except Exception as exc:
                logger.warning("Docker API unavailable — sandbox running in simulation mode: %s", exc)

    def execute_in_sandbox(
        self,
        command: str,
        image: str = "alpine:latest",
        timeout: int = 10,
        env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        if self.firecracker is not None:
            return self.firecracker.execute(command, timeout=timeout, env=env)

        if not self.client:
            logger.info("[SIMULATED SANDBOX] command=%r", command)
            return {
                "status": "simulated_success",
                "output": f"Simulated: {command}",
                "exit_code": 0,
                "sandbox": "simulated",
            }

        container = None
        t_start = time.monotonic()
        try:
            logger.info("Sandbox boot: image=%s command=%r", image, command)
            container = self.client.containers.run(
                image,
                command,
                # ── Network ─────────────────────────────────────
                network_mode="none",
                # ── Filesystem ──────────────────────────────────
                read_only=True,
                tmpfs={
                    "/tmp":     "size=64m,noexec,nosuid,nodev",
                    "/var/tmp": "size=16m,noexec,nosuid,nodev",
                },
                # ── Privileges ──────────────────────────────────
                security_opt=[
                    "no-new-privileges:true",
                    f"seccomp={_SECCOMP_PROFILE}",
                ],
                cap_drop=["ALL"],
                # ── Resources ───────────────────────────────────
                mem_limit="128m",
                memswap_limit="128m",   # swap == mem_limit → no swap
                pids_limit=50,
                # ── Misc ────────────────────────────────────────
                environment=env or {},
                detach=True,
                remove=False,           # explicit removal after log capture
            )

            result = container.wait(timeout=timeout)
            logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")
            elapsed_ms = int((time.monotonic() - t_start) * 1000)

            status = "success" if result["StatusCode"] == 0 else "failed"
            logger.info(
                "Sandbox exit: status=%s exit_code=%d elapsed_ms=%d",
                status, result["StatusCode"], elapsed_ms,
            )
            return {
                "status": status,
                "output": logs,
                "exit_code": result["StatusCode"],
                "elapsed_ms": elapsed_ms,
                "sandbox": "docker-hardened",
            }

        except Exception as exc:
            elapsed_ms = int((time.monotonic() - t_start) * 1000)
            logger.error("Sandbox error after %dms: %s", elapsed_ms, exc)
            return {
                "status": "error",
                "error": str(exc),
                "exit_code": -1,
                "elapsed_ms": elapsed_ms,
                "sandbox": "docker-hardened",
            }

        finally:
            if container is not None:
                try:
                    container.kill()
                except Exception:
                    pass
                try:
                    container.remove(force=True)
                except Exception:
                    pass
