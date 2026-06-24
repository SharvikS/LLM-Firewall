package metrics

import (
	"strings"
	"testing"
)

func TestFormatPrometheusSnapshot(t *testing.T) {
	out := formatPrometheusSnapshot(MetricsSnapshot{
		TotalRequests:   42,
		AllowedRequests: 30,
		BlockedRequests: 12,
		RateLimited:     3,
		CacheHits:       8,
		CacheMisses:     34,
		MLBlocked:       5,
		PIIMasked:       7,
		CedarBlocked:    2,
		P99LatencyMs:    123,
		AvgLatencyMs:    45.5,
	}, 99.25)

	wantLines := []string{
		"# TYPE titan_gateway_requests_total counter",
		"titan_gateway_requests_total 42",
		"titan_gateway_blocked_requests_total 12",
		"titan_gateway_cache_hits_total 8",
		"titan_gateway_latency_p99_ms 123.000000",
		"titan_gateway_latency_avg_ms 45.500000",
		"titan_gateway_uptime_seconds 99.250000",
	}
	for _, line := range wantLines {
		if !strings.Contains(out, line) {
			t.Fatalf("prometheus output missing %q:\n%s", line, out)
		}
	}
}
