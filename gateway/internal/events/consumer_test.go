package events

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// auditEventToRow is the seam between the Kafka wire format and the DB write
// path — every consumer record passes through it, so its UUID edge cases are
// load-bearing: a malformed tenant must degrade to NULL, never poison the
// batch insert.

func TestAuditEventToRowFullEvent(t *testing.T) {
	tenant := uuid.New()
	key := uuid.New()
	evt := AuditEvent{
		EventID:    "evt-1",
		RequestID:  "req-1",
		TenantID:   tenant.String(),
		APIKeyID:   key.String(),
		Action:     "ML_BLOCKED",
		RiskScore:  92.5,
		StatusCode: 403,
		LatencyMs:  12,
		Path:       "/v1/chat/completions",
		Reason:     "PromptInjection",
		Region:     "us-east",
		Timestamp:  time.Now(),
	}

	row := auditEventToRow(evt)
	if row.TenantID == nil || *row.TenantID != tenant {
		t.Fatalf("tenant not mapped: %v", row.TenantID)
	}
	if row.APIKeyID == nil || *row.APIKeyID != key {
		t.Fatalf("api key not mapped: %v", row.APIKeyID)
	}
	if row.Action != "ML_BLOCKED" || row.RiskScore != 92.5 || row.StatusCode != 403 {
		t.Fatalf("scalar fields not mapped: %+v", row)
	}
}

func TestAuditEventToRowDegradesBadUUIDs(t *testing.T) {
	cases := map[string]AuditEvent{
		"empty":     {TenantID: "", APIKeyID: ""},
		"garbage":   {TenantID: "not-a-uuid", APIKeyID: "12345"},
		"nil-uuid":  {TenantID: uuid.Nil.String(), APIKeyID: uuid.Nil.String()},
		"truncated": {TenantID: "0c39a4ab-39cf-4dba", APIKeyID: "0c39"},
	}
	for name, evt := range cases {
		t.Run(name, func(t *testing.T) {
			row := auditEventToRow(evt)
			if row.TenantID != nil {
				t.Errorf("TenantID %q must map to nil, got %v", evt.TenantID, row.TenantID)
			}
			if row.APIKeyID != nil {
				t.Errorf("APIKeyID %q must map to nil, got %v", evt.APIKeyID, row.APIKeyID)
			}
		})
	}
}
