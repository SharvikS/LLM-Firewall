#!/bin/bash
# Build the sample detection plugin to WebAssembly.
# -buildmode=c-shared is REQUIRED: it produces a "reactor" module whose exported
# functions stay callable after init. A normal build runs _start -> main -> exit
# and the exports become unavailable.
set -e
cd "$(dirname "$0")"
OUT="../../../plugins/confidential_terms.wasm"
GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o "$OUT" plugin.go
echo "built $OUT ($(wc -c < "$OUT") bytes)"
