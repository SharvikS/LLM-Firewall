//go:build enterprise

// TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.
//
// Per-tenant usage metering and quota enforcement. Usage counters live in Redis
// (atomic, cheap) keyed by tenant and calendar month. Every operation is
// fail-open — a Redis outage must never affect request serving.
package billing

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Meter records and reads usage. nil-safe and fail-open throughout.
type Meter struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewMeter returns a Meter backed by rdb. Counters expire after ~70 days so the
// previous month stays queryable but old data self-cleans.
func NewMeter(rdb *redis.Client) *Meter {
	return &Meter{rdb: rdb, ttl: 70 * 24 * time.Hour}
}

func period(now time.Time) string { return now.UTC().Format("200601") }

func key(tenant, p string) string { return fmt.Sprintf("billing:usage:%s:%s", tenant, p) }

// Record increments the current month's counters for a tenant: requests always
// +1, plus tokens and (optionally) a blocked event. Fail-open.
func (m *Meter) Record(ctx context.Context, tenantID string, tokens int64, blocked bool, now time.Time) {
	if m == nil || m.rdb == nil {
		return
	}
	k := key(tenantID, period(now))
	pipe := m.rdb.Pipeline()
	pipe.HIncrBy(ctx, k, "requests", 1)
	if tokens > 0 {
		pipe.HIncrBy(ctx, k, "tokens", tokens)
	}
	if blocked {
		pipe.HIncrBy(ctx, k, "blocked", 1)
	}
	pipe.Expire(ctx, k, m.ttl)
	_, _ = pipe.Exec(ctx)
}

// Get returns the current-month usage for a tenant on the given tier.
func (m *Meter) Get(ctx context.Context, tenantID, tier string, now time.Time) Usage {
	plan := PlanFor(tier)
	u := Usage{TenantID: tenantID, Period: period(now), Tier: plan.Tier, Limit: plan.MonthlyRequests}
	if m == nil || m.rdb == nil {
		return u
	}
	if vals, err := m.rdb.HGetAll(ctx, key(tenantID, u.Period)).Result(); err == nil {
		u.Requests = parse(vals["requests"])
		u.Tokens = parse(vals["tokens"])
		u.Blocked = parse(vals["blocked"])
	}
	if u.Limit > 0 {
		u.PercentUsed = float64(u.Requests) / float64(u.Limit) * 100.0
	}
	return u
}

// OverQuota reports whether the tenant has exhausted its monthly request quota.
// Unlimited plans never exceed; Redis errors fail open (not over quota).
func (m *Meter) OverQuota(ctx context.Context, tenantID, tier string, now time.Time) (bool, Usage) {
	u := m.Get(ctx, tenantID, tier, now)
	if u.Limit <= 0 {
		return false, u
	}
	return u.Requests >= u.Limit, u
}

func parse(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
