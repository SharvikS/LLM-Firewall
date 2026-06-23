// Package billing provides the plan catalog plus per-tenant usage metering and
// quota entitlement.
//
// Open-core split: the plan catalog (this file) is part of the MIT core so the
// dashboard can always show pricing. The metering ENGINE — the Redis usage
// counters and quota enforcement — is a commercial feature; its implementation
// lives in meter_enterprise.go (built only with `-tags enterprise`) and is
// replaced by a no-op in meter_community.go. See EDITIONS.md.
package billing

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
