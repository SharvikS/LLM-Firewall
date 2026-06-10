#!/bin/sh
# titan-init — PID 1 inside the Titan Firecracker microVM.
#
# Contract with the host (firecracker_backend.py):
#   1. The command arrives base64-encoded as titan_cmd=<b64> on the kernel
#      command line.
#   2. Output is emitted on the serial console between the BEGIN marker and
#      an EXIT:<code> marker.
#   3. The VM powers off when done; the host treats VMM exit as completion.
#
# The rootfs is mounted read-only; all writable paths are tmpfs.

mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t tmpfs -o size=64m,nosuid,nodev tmpfs /tmp
mount -t tmpfs -o size=16m,nosuid,nodev tmpfs /run

CMD_B64=$(sed -n 's/.*titan_cmd=\([^ ]*\).*/\1/p' /proc/cmdline)

echo "===TITAN-OUTPUT-BEGIN==="
if [ -z "$CMD_B64" ]; then
    echo "titan-init: no titan_cmd on kernel command line" >&2
    echo "===TITAN-EXIT:-1==="
else
    echo "$CMD_B64" | base64 -d > /tmp/titan-cmd.sh
    sh /tmp/titan-cmd.sh
    echo "===TITAN-EXIT:$?==="
fi

# Power off the microVM (Firecracker maps reboot to VMM shutdown).
reboot -f
