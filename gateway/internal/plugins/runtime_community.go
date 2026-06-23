//go:build !enterprise

// Community (open-core, MIT) no-op plugin runtime. The Runtime type and methods
// exist so the data plane compiles and can call Enabled/Scan unconditionally,
// but no WASM modules are ever loaded or executed. The wazero-backed custom-rule
// runtime is a commercial feature (runtime_enterprise.go). This stub also keeps
// the heavy wazero dependency out of the open-core build.
package plugins

import (
	"context"
	"time"
)

// Runtime is a no-op in the community build.
type Runtime struct{}

// Load always returns a disabled runtime in the community build, regardless of
// dir. Never errors.
func Load(_ context.Context, _ string, _ time.Duration) (*Runtime, error) {
	return &Runtime{}, nil
}

// Enabled always reports false in the community build.
func (r *Runtime) Enabled() bool { return false }

// Count always reports zero in the community build.
func (r *Runtime) Count() int { return 0 }

// Scan returns no verdicts in the community build.
func (r *Runtime) Scan(_ context.Context, _ string) []Verdict { return nil }

// Close is a no-op in the community build.
func (r *Runtime) Close(_ context.Context) {}
