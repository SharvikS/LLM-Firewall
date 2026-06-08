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
    Hardened container sandbox for isolated agent tool execution.

    Security controls applied to every container:
      - Network isolation  : network_mode=none
      - Read-only rootfs   : read_only=True
      - No privilege esc.  : no-new-privileges security option
      - Capability drop    : ALL Linux capabilities dropped
      - Seccomp filter     : syscall allowlist profile
      - Resource limits    : 128 MB memory (no swap), 50 PIDs
      - Tmpfs              : /tmp and /var/tmp are in-memory only (noexec)
      - Timeout + cleanup  : hard kill + force-remove after deadline

    Named "Firecracker" for roadmap alignment; this implementation uses Docker
    with hardened security options. True Firecracker MicroVMs require bare-metal
    KVM and are the production upgrade path for multi-tenant environments.
    """

    def __init__(self) -> None:
        self.client = None
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
