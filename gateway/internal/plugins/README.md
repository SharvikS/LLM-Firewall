# WASM Custom-Rule Plugins

Drop-in WebAssembly detection rules that run as an extra pipeline stage (Stage
4b, right after the ML analyzer and before the Cedar policy gate). Use them for
organization-specific rules that don't belong in the core engine — internal
project codenames, customer-specific banned terms, bespoke regex, etc.

Why WASM: a `.wasm` module is a memory-safe, language-agnostic, fully sandboxed
unit. It cannot touch the host filesystem, network, or memory — a buggy or
hostile rule can only ever return a verdict. Rules can also ship and update
independently of the gateway release cycle.

## Enabling

Set `PLUGIN_DIR` to a directory of `.wasm` files:

```
PLUGIN_DIR=/plugins
PLUGIN_TIMEOUT_MS=100   # per-plugin scan budget (default 100ms)
```

In Docker the image bakes the sample plugin into `/plugins` and compose sets
`PLUGIN_DIR=/plugins`. Unset `PLUGIN_DIR` to disable the stage entirely.

The runtime is **fail-open**: a plugin that fails to compile, lacks the ABI,
errors, or times out is skipped (logged) and never blocks traffic on its own
malfunction. A `block` verdict returns HTTP 403 with audit action
`PLUGIN_BLOCKED`.

## ABI

Each module must export (any wasm-targeting language works):

| export | signature | purpose |
|---|---|---|
| `buffer_ptr` | `() i32` | pointer to a shared scratch buffer in module memory |
| `buffer_cap` | `() i32` | capacity of that buffer in bytes |
| `scan` | `(in_len i32) i32` | read prompt from `buffer[:in_len]`, write a JSON verdict back into the buffer, return its length |

Verdict JSON: `{"block": bool, "score": number, "reason": string}`.

## Building the sample (Go → WASM)

```bash
cd internal/plugins/sample
./build.sh      # outputs ../../plugins/confidential_terms.wasm
```

`build.sh` uses `GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared`. The
`-buildmode=c-shared` flag is **required**: it produces a "reactor" module whose
exports stay callable after init. A normal build runs `_start → main → exit` and
the exports become unavailable. Requires Go 1.24+ for `//go:wasmexport`.

To write your own rule, copy `sample/plugin.go`, change the logic in `scan`, and
rebuild. The host only depends on the three exports above.
