package metrics

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// PrometheusText returns a Prometheus text exposition snapshot of gateway
// metrics. It uses the same cross-replica Redis-backed snapshot as the dashboard,
// with local fallback when Redis is unavailable.
func PrometheusText(ctx context.Context) string {
	return formatPrometheusSnapshot(GlobalSnapshot(ctx), time.Since(StartTime).Seconds())
}

func formatPrometheusSnapshot(s MetricsSnapshot, uptimeSeconds float64) string {
	var b strings.Builder
	writeGauge(&b, "titan_gateway_uptime_seconds", "Gateway process uptime in seconds.", uptimeSeconds)
	writeCounter(&b, "titan_gateway_requests_total", "Total proxied LLM requests.", s.TotalRequests)
	writeCounter(&b, "titan_gateway_allowed_requests_total", "Requests allowed through to an upstream provider.", s.AllowedRequests)
	writeCounter(&b, "titan_gateway_blocked_requests_total", "Requests blocked by any gateway guardrail.", s.BlockedRequests)
	writeCounter(&b, "titan_gateway_rate_limited_requests_total", "Requests denied by RPM or TPM limits.", s.RateLimited)
	writeCounter(&b, "titan_gateway_cache_hits_total", "Exact or semantic cache hits served by the gateway.", s.CacheHits)
	writeCounter(&b, "titan_gateway_cache_misses_total", "Requests that missed gateway caches.", s.CacheMisses)
	writeCounter(&b, "titan_gateway_ml_blocked_total", "Requests blocked by the ML analyzer.", s.MLBlocked)
	writeCounter(&b, "titan_gateway_pii_masked_total", "Requests or responses where PII was masked.", s.PIIMasked)
	writeCounter(&b, "titan_gateway_cedar_blocked_total", "Requests blocked by Cedar policy evaluation.", s.CedarBlocked)
	writeGauge(&b, "titan_gateway_latency_p99_ms", "Rolling p99 gateway latency in milliseconds.", float64(s.P99LatencyMs))
	writeGauge(&b, "titan_gateway_latency_avg_ms", "Rolling average gateway latency in milliseconds.", s.AvgLatencyMs)
	return b.String()
}

func writeCounter(b *strings.Builder, name, help string, value int64) {
	writeMetricHeader(b, name, help, "counter")
	fmt.Fprintf(b, "%s %d\n", name, value)
}

func writeGauge(b *strings.Builder, name, help string, value float64) {
	writeMetricHeader(b, name, help, "gauge")
	fmt.Fprintf(b, "%s %.6f\n", name, value)
}

func writeMetricHeader(b *strings.Builder, name, help, typ string) {
	fmt.Fprintf(b, "# HELP %s %s\n", name, help)
	fmt.Fprintf(b, "# TYPE %s %s\n", name, typ)
}
