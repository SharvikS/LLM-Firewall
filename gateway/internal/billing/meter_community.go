//go:build !enterprise

// Community (open-core, MIT) no-op metering. The Meter type and methods exist so
// the gateway compiles and the data plane stays untouched, but no usage is
// recorded and no tenant is ever over quota. The real Redis-backed metering and
// plan-quota enforcement is a commercial feature (meter_enterprise.go).
package billing

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Meter is a no-op in the community build.
type Meter struct{}

// NewMeter returns a dormant Meter regardless of rdb.
func NewMeter(_ *redis.Client) *Meter { return &Meter{} }

// Record does nothing in the community build.
func (m *Meter) Record(_ context.Context, _ string, _ int64, _ bool, _ time.Time) {}

// Get returns plan metadata (tier + limit) with zero usage.
func (m *Meter) Get(_ context.Context, tenantID, tier string, now time.Time) Usage {
	plan := PlanFor(tier)
	return Usage{
		TenantID: tenantID,
		Period:   now.UTC().Format("200601"),
		Tier:     plan.Tier,
		Limit:    plan.MonthlyRequests,
	}
}

// OverQuota never reports over-quota in the community build (no enforcement).
func (m *Meter) OverQuota(ctx context.Context, tenantID, tier string, now time.Time) (bool, Usage) {
	return false, m.Get(ctx, tenantID, tier, now)
}
