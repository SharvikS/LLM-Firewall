package analytics

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeCH returns a test server that records the submitted form and replies
// with the given FORMAT JSON data rows.
func fakeCH(t *testing.T, rows []map[string]any, captured *map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		if captured != nil {
			m := map[string]string{}
			for k := range r.PostForm {
				m[k] = r.PostForm.Get(k)
			}
			*captured = m
		}
		json.NewEncoder(w).Encode(map[string]any{"data": rows}) //nolint:errcheck
	}))
}

func TestNilClientDisabled(t *testing.T) {
	var c *Client
	if c.Enabled() {
		t.Fatal("nil client must report disabled")
	}
	if New("", "", "", "") != nil {
		t.Fatal("empty URL must return nil client")
	}
}

func TestOverviewParsesAggregates(t *testing.T) {
	rows := []map[string]any{{
		"total_requests":   float64(1200),
		"blocked_requests": float64(60),
		"block_rate":       5.0,
		"avg_risk_score":   12.5,
		"avg_latency_ms":   88.2,
		"p99_latency_ms":   450.0,
		"unique_tenants":   float64(3),
	}}
	var captured map[string]string
	srv := fakeCH(t, rows, &captured)
	defer srv.Close()

	c := New(srv.URL, "default", "", "titan")
	ov, err := c.Overview(context.Background(), "tenant-a", 48)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if ov.TotalRequests != 1200 || ov.BlockedRequests != 60 {
		t.Fatalf("unexpected counts: %+v", ov)
	}
	if ov.BlockRate != 5.0 || ov.P99LatencyMs != 450.0 {
		t.Fatalf("unexpected rates: %+v", ov)
	}
	if captured["param_tenant"] != "tenant-a" {
		t.Fatalf("tenant param not passed: %v", captured)
	}
	if captured["param_hours"] != "48" {
		t.Fatalf("hours param not passed: %v", captured)
	}
	if captured["database"] != "titan" {
		t.Fatalf("database not set: %v", captured)
	}
}

func TestTimeseriesAndThreats(t *testing.T) {
	rows := []map[string]any{
		{"time": "2026-06-10 10:00:00", "total": float64(10), "blocked": float64(2),
			"action": "ML_BLOCKED", "cnt": float64(2), "avg_risk": 91.0, "last_seen": "2026-06-10 10:30:00"},
	}
	srv := fakeCH(t, rows, nil)
	defer srv.Close()

	c := New(srv.URL, "", "", "")
	pts, err := c.Timeseries(context.Background(), "", 24)
	if err != nil {
		t.Fatalf("timeseries: %v", err)
	}
	if len(pts) != 1 || pts[0].Total != 10 || pts[0].Blocked != 2 {
		t.Fatalf("unexpected points: %+v", pts)
	}

	threats, err := c.TopThreats(context.Background(), "", 24)
	if err != nil {
		t.Fatalf("threats: %v", err)
	}
	if len(threats) != 1 || threats[0].Action != "ML_BLOCKED" || threats[0].Count != 2 {
		t.Fatalf("unexpected threats: %+v", threats)
	}
}

func TestClampHours(t *testing.T) {
	for in, want := range map[int]int{0: 24, -5: 24, 24: 24, 24 * 90: 24 * 90, 24*90 + 1: 24 * 90} {
		if got := clampHours(in); got != want {
			t.Errorf("clampHours(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestHTTPErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "Code: 60. DB::Exception: Table titan.audit_events does not exist", http.StatusNotFound)
	}))
	defer srv.Close()

	c := New(srv.URL, "", "", "")
	if _, err := c.Overview(context.Background(), "", 24); err == nil {
		t.Fatal("expected error from non-200 response")
	}
}
