// Package billing provides per-tenant usage metering and plan/quota
// entitlement. Usage counters live in Redis (atomic, cheap) keyed by tenant and
// calendar month; plans are a static catalog keyed by the tenant's tier. Every
// operation is fail-open — a Redis outage must never affect request serving.
package billing

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Plan is an entitlement tier. MonthlyRequests == 0 means unlimited.
type Plan struct {
	Tier            string `json:"tier"`
	DisplayName     string `json:"display_name"`
	MonthlyRequests int64  `json:"monthly_requests"`
	PriceUSD        int    `json:"price_usd_per_month"`
}

// Catalog maps tenants.tier → plan. Tier strings match the tenants table.
var Catalog = map[string]Plan{
	"free":       {"free", "Free", 10_000, 0},
	"starter":   {"starter", "Starter", 100_000, 49},
	"pro":        {"pro", "Pro", 1_000_000, 499},
	"enterprise": {"enterprise", "Enterprise", 0, 0},
}

// ordered drives the dashboard plan picker and the Plans() response.
var ordered = []string{"free", "starter", "pro", "enterprise"}

// PlanFor returns the plan for a tier, defaulting to the most restrictive plan
// for an unknown tier (fail-safe: never grant more than configured).
func PlanFor(tier string) Plan {
	if p, ok := Catalog[tier]; ok {
		return p
	}
	return Catalog["free"]
}

// Plans returns the catalog in display order.
func Plans() []Plan {
	out := make([]Plan, 0, len(ordered))
	for _, t := range ordered {
		out = append(out, Catalog[t])
	}
	return out
}

// ValidTier reports whether tier is a known plan.
func ValidTier(tier string) bool {
	_, ok := Catalog[tier]
	return ok
}

// Usage is a tenant's usage for one calendar month.
type Usage struct {
	TenantID    string  `json:"tenant_id"`
	Period      string  `json:"period"` // YYYYMM (UTC)
	Requests    int64   `json:"requests"`
	Tokens      int64   `json:"tokens"`
	Blocked     int64   `json:"blocked"`
	Tier        string  `json:"tier"`
	Limit       int64   `json:"monthly_limit"` // 0 = unlimited
	PercentUsed float64 `json:"percent_used"`  // 0 when unlimited
}

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
