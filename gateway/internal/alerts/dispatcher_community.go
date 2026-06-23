//go:build !enterprise

// Community (open-core, MIT) no-op alert dispatcher. The Dispatcher type and
// methods exist so the data plane compiles and can call Emit unconditionally,
// but no events are delivered anywhere. Real-time SOC alerting (webhook
// delivery, anti-storm coalescing) is a commercial feature
// (dispatcher_enterprise.go).
package alerts

import (
	"context"
	"fmt"
)

// Dispatcher is a no-op in the community build.
type Dispatcher struct{}

// New returns a dormant dispatcher; cfgFn is ignored.
func New(_ func() Config) *Dispatcher { return &Dispatcher{} }

// Emit discards the event in the community build.
func (d *Dispatcher) Emit(_ Event) {}

// SendTest reports that SOC alerting is an enterprise feature.
func (d *Dispatcher) SendTest(_ context.Context, _ string) error {
	return fmt.Errorf("real-time SOC alerting is a TITAN Enterprise feature")
}
