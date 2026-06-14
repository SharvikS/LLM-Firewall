#!/usr/bin/env bash
# Generate a self-signed TLS certificate for the gateway↔ML-engine gRPC channel.
#
#   ./scripts/gen-certs.sh            # writes ./certs/tls.{crt,key}
#   ./scripts/gen-certs.sh /tmp/certs # custom output dir
#
# The same cert is used as the ML engine's server certificate AND as the CA the
# gateway trusts for client-side verification. Its SubjectAltName covers the
# compose service name ("ml_engine"), localhost, and the loopback IP so the one
# cert works both inside Docker and for local runs. Self-signed is fine for an
# internal service-to-service channel; swap in a CA-issued cert for production.
set -euo pipefail

OUT="${1:-certs}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found — install it (Git for Windows bundles it) and retry." >&2
  exit 1
fi

mkdir -p "$OUT"

# Use a config file rather than -subj/-addext: it carries the DN and SANs without
# a leading-slash argument that Git Bash on Windows would mangle into a drive
# path, so the same script works on Windows, Linux and macOS.
CONF="$(mktemp)"
trap 'rm -f "$CONF"' EXIT
cat > "$CONF" <<'EOF'
[req]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[dn]
CN = titan-ml-engine
O  = TITAN
[v3]
subjectAltName = DNS:ml_engine,DNS:localhost,IP:127.0.0.1
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$OUT/tls.key" -out "$OUT/tls.crt" \
  -config "$CONF" 2>/dev/null

chmod 600 "$OUT/tls.key" 2>/dev/null || true

echo "Wrote $OUT/tls.crt and $OUT/tls.key"
echo "Subject Alternative Names:"
openssl x509 -in "$OUT/tls.crt" -noout -ext subjectAltName | sed 's/^/  /'
echo
echo "Enable TLS with:"
echo "  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build"
