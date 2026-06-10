package api

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

func TestAuditRowToCSV(t *testing.T) {
	tenant := uuid.New()
	risk := 42.5
	lat := int64(120)
	status := 200
	path := "/v1/chat/completions"
	reason := "ok"

	row := auditRowToCSV(store.AuditEventRow{
		ID:         uuid.New(),
		RequestID:  "req-1",
		TenantID:   &tenant,
		Action:     "ALLOWED",
		RiskScore:  &risk,
		Path:       &path,
		LatencyMs:  &lat,
		StatusCode: &status,
		Reason:     &reason,
		Region:     "us-east",
		CreatedAt:  time.Now(),
	})

	if len(row) != len(auditCSVHeader) {
		t.Fatalf("row width %d != header width %d", len(row), len(auditCSVHeader))
	}
	if row[3] != tenant.String() || row[5] != "ALLOWED" || row[6] != "42.50" || row[8] != "120" {
		t.Fatalf("unexpected row: %v", row)
	}
}

func TestAuditRowToCSVNilFields(t *testing.T) {
	row := auditRowToCSV(store.AuditEventRow{
		ID:        uuid.New(),
		RequestID: "req-2",
		Action:    "ML_BLOCKED",
		Region:    "unknown",
		CreatedAt: time.Now(),
	})
	if row[3] != "" || row[6] != "" || row[8] != "" || row[9] != "" {
		t.Fatalf("nil fields must be empty cells: %v", row)
	}
}

func TestComplianceParams(t *testing.T) {
	r := httptest.NewRequest("GET", "/admin/v1/compliance/report?from=2026-05-01&to=2026-06-01", nil)
	from, to, tenant, err := complianceParams(r)
	if err != nil {
		t.Fatalf("params: %v", err)
	}
	if tenant != nil {
		t.Fatal("tenant should be nil when absent")
	}
	if from.Format("2006-01-02") != "2026-05-01" || to.Format("2006-01-02") != "2026-06-01" {
		t.Fatalf("bad range: %v – %v", from, to)
	}

	// inverted range rejected
	r = httptest.NewRequest("GET", "/x?from=2026-06-01&to=2026-05-01", nil)
	if _, _, _, err := complianceParams(r); err == nil {
		t.Fatal("inverted range must error")
	}

	// bad tenant rejected
	r = httptest.NewRequest("GET", "/x?tenant=not-a-uuid", nil)
	if _, _, _, err := complianceParams(r); err == nil {
		t.Fatal("bad tenant must error")
	}

	// defaults: trailing 30 days
	r = httptest.NewRequest("GET", "/x", nil)
	from, to, _, err = complianceParams(r)
	if err != nil {
		t.Fatalf("defaults: %v", err)
	}
	if d := to.Sub(from); d < 29*24*time.Hour || d > 31*24*time.Hour {
		t.Fatalf("default window should be ~30 days, got %v", d)
	}
}
