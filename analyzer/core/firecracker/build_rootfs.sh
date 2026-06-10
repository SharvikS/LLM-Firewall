#!/usr/bin/env bash
# Builds the minimal ext4 rootfs the Titan Firecracker backend boots.
# Run on a Linux host with Docker available:
#
#   sudo ./build_rootfs.sh [output.ext4]
#
# Also fetch an uncompressed kernel (vmlinux). The Firecracker project
# publishes CI kernels, e.g.:
#   https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.10/x86_64/vmlinux-5.10.225
#
# Then point the analyzer at the artifacts:
#   export FC_KERNEL_IMAGE=/var/lib/titan/vmlinux
#   export FC_ROOTFS=/var/lib/titan/rootfs.ext4
set -euo pipefail

OUT="${1:-rootfs.ext4}"
SIZE_MB=128
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ">> creating ${SIZE_MB}MB ext4 image at ${OUT}"
dd if=/dev/zero of="$OUT" bs=1M count="$SIZE_MB" status=none
mkfs.ext4 -q "$OUT"

MNT="$(mktemp -d)"
trap 'umount "$MNT" 2>/dev/null || true; rmdir "$MNT"' EXIT
mount -o loop "$OUT" "$MNT"

echo ">> populating rootfs from alpine:3.20"
CID=$(docker create alpine:3.20)
docker export "$CID" | tar -xC "$MNT"
docker rm "$CID" >/dev/null

echo ">> installing titan-init"
install -m 0755 "$SCRIPT_DIR/titan-init.sh" "$MNT/sbin/titan-init"

umount "$MNT"
trap - EXIT
rmdir "$MNT"

echo ">> done: $OUT"
echo "   FC_ROOTFS=$(realpath "$OUT")"
