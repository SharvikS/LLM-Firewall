// Package integration holds DB-backed end-to-end tests covering the
// auth → policy → audit pipeline and multi-tenant isolation guarantees.
// Tests skip (not fail) when no test database is reachable; point
// DB_TEST_CONN_STRING at Postgres or CockroachDB to enable them, e.g.
//
//	DB_TEST_CONN_STRING="postgresql://root@localhost:26257/titan_test?sslmode=disable" go test ./internal/integration/
package integration

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
	"github.com/sharvik/llm-firewall/gateway/internal/testhelper"
)

// TestE2E_AuthPolicyAuditPipeline walks one request's full governance path
// against a real database: API-key auth resolves the tenant, the Cedar
// engine evaluates DB-stored policies, audit rows land via the batch
// writer, and the keyset cursor + compliance summary read them back.
func TestE2E_AuthPolicyAuditPipeline(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	ctx := context.Background()

	// ── Stage 1: tenant + key provisioning ───────────────────────────────
	tenant, err := st.CreateTenant(ctx, "acme-e2e", "enterprise", 600)
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	rawKey, _, err := st.GenerateAPIKey(ctx, tenant.ID, "e2e-key")
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	// ── Stage 2: API-key auth middleware (fail-closed) ───────────────────
	var seen middleware.AuthContext
	handler := middleware.APIKeyAuth(st)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = middleware.GetAuthContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid key rejected: %d %s", rec.Code, rec.Body.String())
	}
	if seen.TenantID != tenant.ID {
		t.Fatalf("auth resolved wrong tenant: %s != %s", seen.TenantID, tenant.ID)
	}

	rec = httptest.NewRecorder()
	badReq := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	badReq.Header.Set("Authorization", "Bearer titan_forged_key_000000000000")
	handler.ServeHTTP(rec, badReq)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged key must 401, got %d", rec.Code)
	}

	// ── Stage 3: Cedar policy evaluation over DB-stored policies ─────────
	if _, err := st.CreatePolicy(ctx, store.CreatePolicyInput{
		Name: "allow-all-e2e", Effect: "ALLOW", Principal: "*", Action: "*",
	}); err != nil {
		t.Fatalf("create permit policy: %v", err)
	}
	if _, err := st.CreatePolicy(ctx, store.CreatePolicyInput{
		Name: "block-high-risk-e2e", Effect: "DENY", Principal: "*", Action: "*",
		Condition: "risk_score > 70",
	}); err != nil {
		t.Fatalf("create forbid policy: %v", err)
	}

	eng := policy.NewEngine(st) // loads the policy set synchronously

	if ok, reason := eng.Evaluate(ctx, tenant.ID, "invoke", "groq/llama-3", map[string]any{
		"risk_score": 10.0,
	}); !ok {
		t.Fatalf("low-risk request must be allowed, got deny: %s", reason)
	}
	if ok, _ := eng.Evaluate(ctx, tenant.ID, "invoke", "groq/llama-3", map[string]any{
		"risk_score": 95.0,
	}); ok {
		t.Fatal("risk 95 must be denied by forbid policy (forbid wins)")
	}

	// ── Stage 4: audit write path + keyset cursor read-back ──────────────
	const totalEvents = 25
	var rows []store.AuditRow
	for i := 0; i < totalEvents; i++ {
		rows = append(rows, store.AuditRow{
			EventID:    fmt.Sprintf("e2e-%d", i),
			RequestID:  fmt.Sprintf("req-%d", i),
			TenantID:   &tenant.ID,
			Action:     map[bool]string{true: "ALLOWED", false: "ML_BLOCKED"}[i%5 != 0],
			RiskScore:  float64(i * 4),
			Path:       "/v1/chat/completions",
			LatencyMs:  int64(40 + i),
			StatusCode: 200,
			Region:     "test-region",
		})
	}
	if err := st.InsertAuditBatch(ctx, rows); err != nil {
		t.Fatalf("audit batch insert: %v", err)
	}
	// Idempotency: replaying the batch (Kafka at-least-once) adds nothing.
	if err := st.InsertAuditBatch(ctx, rows); err != nil {
		t.Fatalf("audit batch replay: %v", err)
	}

	collected := map[uuid.UUID]bool{}
	var cursor *store.AuditCursor
	pages := 0
	for {
		page, next, err := st.ListAuditEventsCursor(ctx, &tenant.ID, 10, cursor)
		if err != nil {
			t.Fatalf("cursor page %d: %v", pages, err)
		}
		for _, e := range page {
			if collected[e.ID] {
				t.Fatalf("event %s returned twice across pages", e.ID)
			}
			collected[e.ID] = true
		}
		pages++
		if next == nil {
			break
		}
		cursor = next
	}
	if len(collected) != totalEvents {
		t.Fatalf("cursor walk returned %d events, want %d (replay must not duplicate)", len(collected), totalEvents)
	}
	if pages != 3 { // 10 + 10 + 5
		t.Fatalf("expected 3 pages of ≤10, got %d", pages)
	}

	// ── Stage 5: compliance summary over the same trail ───────────────────
	sum, err := st.GetComplianceSummary(ctx, &tenant.ID,
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("compliance summary: %v", err)
	}
	if sum.TotalEvents != totalEvents {
		t.Fatalf("summary total %d, want %d", sum.TotalEvents, totalEvents)
	}
	if sum.ActionBreakdown["ML_BLOCKED"] != 5 {
		t.Fatalf("expected 5 ML_BLOCKED in breakdown, got %v", sum.ActionBreakdown)
	}
}

// TestE2E_MultiTenantIsolation verifies that tenant-scoped reads can never
// leak rows across tenants — the core zero-trust guarantee of the store.
func TestE2E_MultiTenantIsolation(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	ctx := context.Background()

	tenantA, err := st.CreateTenant(ctx, "tenant-a-iso", "standard", 60)
	if err != nil {
		t.Fatalf("tenant A: %v", err)
	}
	tenantB, err := st.CreateTenant(ctx, "tenant-b-iso", "standard", 60)
	if err != nil {
		t.Fatalf("tenant B: %v", err)
	}

	mk := func(tid uuid.UUID, n int, prefix string) []store.AuditRow {
		var out []store.AuditRow
		for i := 0; i < n; i++ {
			id := tid
			out = append(out, store.AuditRow{
				EventID:   fmt.Sprintf("%s-%d", prefix, i),
				RequestID: fmt.Sprintf("%s-req-%d", prefix, i),
				TenantID:  &id,
				Action:    "ALLOWED",
				Region:    "test-region",
			})
		}
		return out
	}
	if err := st.InsertAuditBatch(ctx, mk(tenantA.ID, 7, "iso-a")); err != nil {
		t.Fatalf("insert A: %v", err)
	}
	if err := st.InsertAuditBatch(ctx, mk(tenantB.ID, 3, "iso-b")); err != nil {
		t.Fatalf("insert B: %v", err)
	}

	// Tenant-scoped cursor list returns only that tenant's rows.
	rowsA, _, err := st.ListAuditEventsCursor(ctx, &tenantA.ID, 100, nil)
	if err != nil {
		t.Fatalf("list A: %v", err)
	}
	if len(rowsA) != 7 {
		t.Fatalf("tenant A sees %d rows, want 7", len(rowsA))
	}
	for _, e := range rowsA {
		if e.TenantID == nil || *e.TenantID != tenantA.ID {
			t.Fatalf("tenant A result leaked foreign row: %+v", e)
		}
	}

	// Tenant-scoped compliance summary counts only that tenant.
	sumB, err := st.GetComplianceSummary(ctx, &tenantB.ID,
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("summary B: %v", err)
	}
	if sumB.TotalEvents != 3 {
		t.Fatalf("tenant B summary counts %d, want 3", sumB.TotalEvents)
	}

	// API keys are tenant-scoped: A's listing never contains B's key.
	if _, _, err := st.GenerateAPIKey(ctx, tenantB.ID, "b-key"); err != nil {
		t.Fatalf("generate B key: %v", err)
	}
	keysA, err := st.ListAPIKeys(ctx, tenantA.ID)
	if err != nil {
		t.Fatalf("list A keys: %v", err)
	}
	if len(keysA) != 0 {
		t.Fatalf("tenant A must have no keys, saw %d (cross-tenant leak)", len(keysA))
	}
}
