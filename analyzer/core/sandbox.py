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
            # ── Modern runc/glibc init requirements ─────────────────────────
            # The original list predates current runc + glibc, which use these
            # newer syscalls during container init and normal libc operation.
            # Without them the container fails to start under seccomp ("error
            # during container init"), forcing a silent drop to no isolation.
            "statx", "statfs", "fstatfs", "newfstatat", "openat2",
            "faccessat", "faccessat2", "close_range", "clone3", "rseq",
            "set_robust_list", "get_robust_list", "prlimit64", "getrandom",
            "pipe2", "dup3", "epoll_create1", "epoll_pwait2", "eventfd2",
            "signalfd4", "pidfd_open", "pidfd_send_signal", "memfd_create",
            "membarrier", "restart_syscall", "rt_sigpending",
            "rt_sigtimedwait", "rt_sigsuspend", "rt_sigqueueinfo",
            "sigaltstack", "sched_getaffinity", "sched_setaffinity",
            "setresuid", "setresgid", "setuid", "setgid", "setgroups",
            "setsid", "getppid", "getpgrp", "getpgid", "getsid", "setpgid",
            "wait4", "waitid", "gettid", "gettid", "tkill", "getpriority",
            "setpriority", "ppoll", "pselect6", "getrandom", "clock_getres",
        ],
        "action": "SCMP_ACT_ALLOW",
    }],
})


def _connect_docker():
    """
    Connect to the Docker daemon, tolerant of non-default socket locations.

    docker.from_env() honours DOCKER_HOST / the default /var/run/docker.sock,
    which covers Linux and most CI. Docker Desktop on macOS exposes its socket
    under the user's home (~/.docker/run/docker.sock) and only symlinks
    /var/run/docker.sock when the privileged helper is installed — so we fall
    back to the known Desktop paths before giving up and dropping to simulation.
    Returns a pinging client, or None when no daemon is reachable.
    """
    import os

    try:
        import docker  # type: ignore
    except Exception as exc:  # docker SDK not installed
        logger.warning("docker SDK not importable: %s", exc)
        return None

    candidates = []
    if os.getenv("DOCKER_HOST"):
        candidates.append(None)  # let from_env() read DOCKER_HOST
    candidates.append(None)      # from_env() default (/var/run/docker.sock)
    home = os.path.expanduser("~")
    candidates += [
        f"unix://{home}/.docker/run/docker.sock",  # Docker Desktop (macOS)
        "unix:///var/run/docker.sock",             # explicit default
    ]

    seen = set()
    for base in candidates:
        key = base or "from_env"
        if key in seen:
            continue
        seen.add(key)
        try:
            client = docker.from_env() if base is None else docker.DockerClient(base_url=base)
            client.ping()  # fail fast if the daemon is not actually reachable
            return client
        except Exception:
            continue
    return None


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
            self.client = _connect_docker()
            if self.client is not None:
                logger.info("Sandbox connected to Docker API (hardened-container isolation active)")
            else:
                logger.warning("Docker API unavailable — sandbox running in simulation mode")

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
