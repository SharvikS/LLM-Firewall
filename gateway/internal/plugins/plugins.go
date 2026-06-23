// Package plugins runs operator-supplied WebAssembly detection rules as an
// extra, sandboxed stage of the request pipeline.
//
// Open-core split: the Verdict value type (this file) is part of the MIT core so
// the data plane can iterate plugin results unconditionally. The wazero-backed
// runtime that actually compiles and executes .wasm modules is a commercial
// feature — its implementation is in runtime_enterprise.go (built only with
// `-tags enterprise`) and is replaced by a no-op in runtime_community.go. See
// EDITIONS.md.
package plugins

// Verdict is the result of one plugin evaluating a prompt.
type Verdict struct {
	Block  bool    `json:"block"`
	Score  float64 `json:"score"`
	Reason string  `json:"reason"`
	Plugin string  `json:"plugin"` // filled by the runtime, not the module
}
