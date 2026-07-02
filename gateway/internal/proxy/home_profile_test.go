package proxy

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/testhelper"
)

// TestEmitKafka_NoBrokerConfigured_PersistsDirectlyToDB proves the Home
// profile's core assumption: with KAFKA_BROKERS="" (producer nil), audit
// events for the data-plane proxy path still land in CockroachDB via the
// direct fallback path, not just when Kafka is up.
func TestEmitKafka_NoBrokerConfigured_PersistsDirectlyToDB(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)

	p := &LLMProxy{st: st, provider: "Groq"} // producer left nil on purpose

	tenant, err := st.CreateTenant(context.Background(), "home-profile-proxy-test", "standard", 60)
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}

	reqID := uuid.New().String()
	tenantID := tenant.ID

	p.emitKafka(reqID, tenantID, uuid.Nil, "ALLOW", 12.5,
		"/v1/chat/completions", 200, 42, "", "", "llama-3.1-8b-instant")

	// persistAuditFallback writes in a background goroutine; poll briefly
	// rather than sleeping a fixed amount.
	deadline := time.Now().Add(2 * time.Second)
	for {
		rows, _, err := st.ListAuditEvents(context.Background(), &tenantID, 10, 0)
		if err != nil {
			t.Fatalf("ListAuditEvents: %v", err)
		}
		if len(rows) == 1 {
			if rows[0].RequestID != reqID {
				t.Fatalf("RequestID = %q, want %q", rows[0].RequestID, reqID)
			}
			if rows[0].Action != "ALLOW" {
				t.Fatalf("Action = %q, want ALLOW", rows[0].Action)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected 1 audit row for tenant %s, got %d after waiting", tenantID, len(rows))
		}
		time.Sleep(50 * time.Millisecond)
	}
}
