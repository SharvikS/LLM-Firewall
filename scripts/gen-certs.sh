#!/usr/bin/env bash
# Generate a CA plus server and client certificates for the gateway↔ML-engine
# gRPC channel. Produces, in the output dir:
#
#   ca.crt              — the CA both sides trust
#   tls.crt / tls.key   — ML-engine server cert (SAN: ml_engine, localhost, 127.0.0.1)
#   client.crt / client.key — gateway client cert (for mutual TLS)
#
# One-way TLS uses ca.crt + tls.{crt,key}. Mutual TLS additionally uses
# client.{crt,key} on the gateway and ca.crt as the client CA on the server.
# Self-signed is fine for an internal service-to-service channel; swap in
# CA-issued certs for production.
#
#   ./scripts/gen-certs.sh            # writes ./certs/*
#   ./scripts/gen-certs.sh /tmp/certs # custom output dir
set -euo pipefail

OUT="${1:-certs}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found — install it (Git for Windows bundles it) and retry." >&2
  exit 1
fi
mkdir -p "$OUT"

# Config files avoid leading-slash -subj args that Git Bash mangles on Windows.
CA_CNF="$(mktemp)"; SRV_CNF="$(mktemp)"; CLI_CNF="$(mktemp)"
trap 'rm -f "$CA_CNF" "$SRV_CNF" "$CLI_CNF"' EXIT

cat > "$CA_CNF" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = TITAN-Internal-CA
O  = TITAN
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
EOF

cat > "$SRV_CNF" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = titan-ml-engine
O  = TITAN
[v3]
subjectAltName = DNS:ml_engine,DNS:localhost,IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF

cat > "$CLI_CNF" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = titan-gateway
O  = TITAN
[v3]
extendedKeyUsage = clientAuth
EOF

# CA
openssl req -x509 -newkey rsa:2048 -nodes -days 1825 \
  -keyout "$OUT/ca.key" -out "$OUT/ca.crt" -config "$CA_CNF" 2>/dev/null

# Server cert signed by the CA
openssl req -newkey rsa:2048 -nodes -keyout "$OUT/tls.key" \
  -out "$OUT/server.csr" -config "$SRV_CNF" 2>/dev/null
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -CAcreateserial -days 825 -extfile "$SRV_CNF" -extensions v3 \
  -out "$OUT/tls.crt" 2>/dev/null

# Client cert signed by the CA
openssl req -newkey rsa:2048 -nodes -keyout "$OUT/client.key" \
  -out "$OUT/client.csr" -config "$CLI_CNF" 2>/dev/null
openssl x509 -req -in "$OUT/client.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -CAcreateserial -days 825 -extfile "$CLI_CNF" -extensions v3 \
  -out "$OUT/client.crt" 2>/dev/null

rm -f "$OUT/server.csr" "$OUT/client.csr" "$OUT/ca.srl"
chmod 600 "$OUT"/*.key 2>/dev/null || true

echo "Wrote CA + server + client certs to $OUT/"
echo "Verify chain:"
openssl verify -CAfile "$OUT/ca.crt" "$OUT/tls.crt" | sed 's/^/  /'
openssl verify -CAfile "$OUT/ca.crt" "$OUT/client.crt" | sed 's/^/  /'
echo
echo "Enable mutual TLS with:"
echo "  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build"
