// Package analytics provides the OLAP read path backed by ClickHouse.
// Audit events flow gateway → Kafka → ClickHouse (Kafka engine + MV, see
// platform/clickhouse/init.sql); this package only ever reads.
//
// Queries go over the ClickHouse HTTP interface using server-side query
// parameters ({name:Type} + param_name form values), so no SQL is ever
// string-built from user input.
package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client queries ClickHouse over its HTTP interface (port 8123).
// A nil *Client is safe to use: Enabled() reports false.
type Client struct {
	baseURL  string
	user     string
	password string
	database string
	hc       *http.Client
}

// New returns a ClickHouse analytics client, or nil when baseURL is empty
// (analytics disabled).
func New(baseURL, user, password, database string) *Client {
	if baseURL == "" {
		return nil
	}
	if database == "" {
		database = "titan"
	}
	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		user:     user,
		password: password,
		database: database,
		hc:       &http.Client{Timeout: 10 * time.Second},
	}
}

// Enabled reports whether the analytics layer is configured.
func (c *Client) Enabled() bool { return c != nil }

// Overview is the headline aggregate block for the analytics dashboard.
type Overview struct {
	TotalRequests   uint64  `json:"total_requests"`
	BlockedRequests uint64  `json:"blocked_requests"`
	BlockRate       float64 `json:"block_rate"`
	AvgRiskScore    float64 `json:"avg_risk_score"`
	AvgLatencyMs    float64 `json:"avg_latency_ms"`
	P99LatencyMs    float64 `json:"p99_latency_ms"`
	UniqueTenants   uint64  `json:"unique_tenants"`
}

// TimePoint is one bucket of the requests-over-time series.
type TimePoint struct {
	Time    string `json:"time"`
	Total   uint64 `json:"total"`
	Blocked uint64 `json:"blocked"`
}

// ThreatCount is one row of the threat-breakdown table.
type ThreatCount struct {
	Action   string  `json:"action"`
	Count    uint64  `json:"count"`
	AvgRisk  float64 `json:"avg_risk"`
	LastSeen string  `json:"last_seen"`
}

// Overview returns headline aggregates for the trailing window.
// tenantID filters to a single tenant when non-empty.
func (c *Client) Overview(ctx context.Context, tenantID string, hours int) (*Overview, error) {
	const q = `
SELECT
    count()                                  AS total_requests,
    countIf(action != 'ALLOWED')             AS blocked_requests,
    if(count() > 0, countIf(action != 'ALLOWED') / count() * 100, 0) AS block_rate,
    if(count() > 0, avg(risk_score), 0)      AS avg_risk_score,
    if(count() > 0, avg(latency_ms), 0)      AS avg_latency_ms,
    if(count() > 0, quantile(0.99)(latency_ms), 0) AS p99_latency_ms,
    uniqExact(tenant_id)                     AS unique_tenants
FROM audit_events
WHERE timestamp >= now() - INTERVAL {hours:UInt32} HOUR
  AND ({tenant:String} = '' OR tenant_id = {tenant:String})`

	rows, err := c.query(ctx, q, map[string]string{
		"hours":  fmt.Sprint(clampHours(hours)),
		"tenant": tenantID,
	})
	if err != nil {
		return nil, err
	}
	out := &Overview{}
	if len(rows) > 0 {
		r := rows[0]
		out.TotalRequests = asUint(r["total_requests"])
		out.BlockedRequests = asUint(r["blocked_requests"])
		out.BlockRate = asFloat(r["block_rate"])
		out.AvgRiskScore = asFloat(r["avg_risk_score"])
		out.AvgLatencyMs = asFloat(r["avg_latency_ms"])
		out.P99LatencyMs = asFloat(r["p99_latency_ms"])
		out.UniqueTenants = asUint(r["unique_tenants"])
	}
	return out, nil
}

// Timeseries returns hourly request/block counts for the trailing window,
// with empty buckets zero-filled by ClickHouse (WITH FILL).
func (c *Client) Timeseries(ctx context.Context, tenantID string, hours int) ([]TimePoint, error) {
	const q = `
SELECT
    toString(toStartOfHour(timestamp))   AS time,
    count()                              AS total,
    countIf(action != 'ALLOWED')         AS blocked
FROM audit_events
WHERE timestamp >= now() - INTERVAL {hours:UInt32} HOUR
  AND ({tenant:String} = '' OR tenant_id = {tenant:String})
GROUP BY toStartOfHour(timestamp)
ORDER BY toStartOfHour(timestamp)`

	rows, err := c.query(ctx, q, map[string]string{
		"hours":  fmt.Sprint(clampHours(hours)),
		"tenant": tenantID,
	})
	if err != nil {
		return nil, err
	}
	points := make([]TimePoint, 0, len(rows))
	for _, r := range rows {
		points = append(points, TimePoint{
			Time:    asString(r["time"]),
			Total:   asUint(r["total"]),
			Blocked: asUint(r["blocked"]),
		})
	}
	return points, nil
}

// TopThreats returns block counts grouped by action for the trailing window.
func (c *Client) TopThreats(ctx context.Context, tenantID string, hours int) ([]ThreatCount, error) {
	const q = `
SELECT
    action,
    count()                    AS cnt,
    avg(risk_score)            AS avg_risk,
    toString(max(timestamp))   AS last_seen
FROM audit_events
WHERE timestamp >= now() - INTERVAL {hours:UInt32} HOUR
  AND action != 'ALLOWED'
  AND ({tenant:String} = '' OR tenant_id = {tenant:String})
GROUP BY action
ORDER BY cnt DESC
LIMIT 20`

	rows, err := c.query(ctx, q, map[string]string{
		"hours":  fmt.Sprint(clampHours(hours)),
		"tenant": tenantID,
	})
	if err != nil {
		return nil, err
	}
	threats := make([]ThreatCount, 0, len(rows))
	for _, r := range rows {
		threats = append(threats, ThreatCount{
			Action:   asString(r["action"]),
			Count:    asUint(r["cnt"]),
			AvgRisk:  asFloat(r["avg_risk"]),
			LastSeen: asString(r["last_seen"]),
		})
	}
	return threats, nil
}

// query executes a parameterized SELECT and returns FORMAT JSON data rows.
func (c *Client) query(ctx context.Context, sql string, params map[string]string) ([]map[string]any, error) {
	form := url.Values{}
	form.Set("query", sql+" FORMAT JSON")
	form.Set("database", c.database)
	// Return numbers as JSON numbers, not quoted strings (UInt64 default).
	form.Set("output_format_json_quote_64bit_integers", "0")
	for k, v := range params {
		form.Set("param_"+k, v)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if c.user != "" {
		req.SetBasicAuth(c.user, c.password)
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("clickhouse unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("clickhouse HTTP %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var parsed struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("clickhouse response parse: %w", err)
	}
	return parsed.Data, nil
}

func clampHours(h int) int {
	if h <= 0 {
		return 24
	}
	if h > 24*90 { // TTL horizon
		return 24 * 90
	}
	return h
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func asUint(v any) uint64 {
	switch x := v.(type) {
	case float64:
		return uint64(x)
	case string:
		var n uint64
		fmt.Sscanf(x, "%d", &n)
		return n
	}
	return 0
}

func asFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		var f float64
		fmt.Sscanf(x, "%f", &f)
		return f
	}
	return 0
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
