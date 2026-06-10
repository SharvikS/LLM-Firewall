# gRPC Schema Versioning Policy

The gateway (Go) and ML engine (Python) communicate over the contract in
`analyzer/v1/analyzer.proto`. Both sides are generated from this single
source of truth, but they deploy independently — so the wire contract is
governed by the rules below.

## Version layout

```
proto/
└── analyzer/
    └── v1/              ← package analyzer.v1 (current)
        └── analyzer.proto
```

The protobuf package (`analyzer.v1`) and the directory path always match.
A **breaking change ships as a new package** (`analyzer/v2/analyzer.proto`,
`package analyzer.v2`) served side-by-side with v1 — never as an edit to v1.

## Rules for changes WITHIN a version (v1)

Additive, wire-compatible changes only:

1. **Never reuse or renumber a field.** Tag numbers are the wire contract.
2. **Never change a field's type or name-then-meaning.** Renaming is safe on
   the wire but breaks JSON mappings and generated code — treat it as breaking.
3. **Deleting a field requires `reserved`.** Reserve both the number and the
   name so it can never be reused:
   ```proto
   reserved 8;
   reserved "old_field_name";
   ```
4. **New fields must be optional in behavior.** Receivers must tolerate the
   field being absent (proto3 default value) — the other side may be older.
5. **New enum values are additive-only** and receivers must treat unknown
   enum values as a safe default (`Action.ALLOW` is value 0 deliberately:
   fail-open is the gateway's documented ML-gate posture; the risk gate
   still applies downstream).
6. **New RPCs may be added** to an existing service; removing one is breaking.

## Rules for a NEW version (v2)

- Copy the proto into `analyzer/v2/`, change the package, make the breaking
  change there.
- The ML engine serves **both** versions during the migration window
  (two registered servicers on the same gRPC server).
- The gateway pins the version it calls via its generated client import.
- v1 may be retired only after every gateway replica in every region has
  been observed calling v2 (check the `grpc.method` label on traces).

## Enforcement

`buf.yaml` at this directory configures lint + breaking-change detection.
Run before committing any proto change:

```bash
cd ml_engine/proto
buf lint
buf breaking --against '../../.git#subdir=ml_engine/proto'
```

`buf breaking` compares the working tree against the last commit and fails
on any wire-incompatible edit (deleted field without `reserved`, type change,
tag reuse, removed RPC, …). CI should run the same two commands.

## Regenerating stubs

| Side | Command |
|---|---|
| Go (gateway) | `protoc --go_out=. --go-grpc_out=. analyzer/v1/analyzer.proto` (module-mapped into `gateway/internal/analyzerpb`) |
| Python (ml_engine) | `python -m grpc_tools.protoc -I. --python_out=../analyzer --grpc_python_out=../analyzer analyzer/v1/analyzer.proto` |

Generated code is committed; both sides must be regenerated in the same PR
as the proto change.
