package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
)


// ── HashKey ───────────────────────────────────────────────────────────────────

func TestHashKey(t *testing.T) {
	t.Run("deterministic", func(t *testing.T) {
		h1 := HashKey("titan_dev_localkeyfortesting1234")
		h2 := HashKey("titan_dev_localkeyfortesting1234")
		if h1 != h2 {
			t.Errorf("HashKey is not deterministic: %s vs %s", h1, h2)
		}
	})

	t.Run("known_value", func(t *testing.T) {
		// Pre-computed SHA-256 of the dev key — validated in Phase 5 seed fix.
		const key  = "titan_dev_localkeyfortesting1234"
		const want = "423dc836d6e0dd409ff96c02e6833a4eb83e61de5730a243520255aa9a56dd55"
		got := HashKey(key)
		if got != want {
			t.Errorf("HashKey(%q) = %q; want %q", key, got, want)
		}
	})

	t.Run("different_keys_different_hashes", func(t *testing.T) {
		h1 := HashKey("key-alpha")
		h2 := HashKey("key-beta")
		if h1 == h2 {
			t.Error("different keys produced the same hash")
		}
	})

	t.Run("length_is_64_hex_chars", func(t *testing.T) {
		h := HashKey("anything")
		if len(h) != 64 {
			t.Errorf("hash length = %d; want 64", len(h))
		}
	})
}

// ── Store integration tests (require titan_test DB) ───────────────────────────

func openTestStore(t *testing.T) *Store {
	t.Helper()
	const dsn = "postgresql://localhost/titan_test?sslmode=disable"
	st, err := New(context.Background(), dsn)
	if err != nil {
		t.Skipf("titan_test DB not available (%v) — skipping integration tests", err)
	}
	t.Cleanup(func() {
		st.Pool().Exec(context.Background(), //nolint:errcheck
			`TRUNCATE api_keys, policies, audit_events, tenants RESTART IDENTITY CASCADE`)
		st.Close()
	})
	return st
}

func TestGenerateAndLookupAPIKey(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	// Create a tenant first.
	tenant, err := st.CreateTenant(ctx, "test-tenant", "standard", 60)
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}

	// Generate a key.
	rawKey, key, err := st.GenerateAPIKey(ctx, tenant.ID, "Test Key")
	if err != nil {
		t.Fatalf("GenerateAPIKey: %v", err)
	}
	if rawKey == "" {
		t.Error("raw key must not be empty")
	}
	if key.KeyPrefix != rawKey[:8] {
		t.Errorf("key_prefix = %q; want %q", key.KeyPrefix, rawKey[:8])
	}

	// Look up by hash.
	hash := HashKey(rawKey)
	found, err := st.GetAPIKeyByHash(ctx, hash)
	if err != nil {
		t.Fatalf("GetAPIKeyByHash: %v", err)
	}
	if found == nil {
		t.Fatal("GetAPIKeyByHash returned nil for a key we just generated")
	}
	if found.ID != key.ID {
		t.Errorf("found.ID = %v; want %v", found.ID, key.ID)
	}

	// Invalid hash → nil, no error.
	missing, err := st.GetAPIKeyByHash(ctx, "deadbeef")
	if err != nil {
		t.Fatalf("GetAPIKeyByHash(invalid): unexpected error: %v", err)
	}
	if missing != nil {
		t.Error("GetAPIKeyByHash(invalid) should return nil")
	}
}

func TestRevokeAPIKey(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	tenant, _ := st.CreateTenant(ctx, "revoke-tenant", "standard", 60)
	rawKey, key, _ := st.GenerateAPIKey(ctx, tenant.ID, "Revoke Me")

	// Confirm key is active.
	found, _ := st.GetAPIKeyByHash(ctx, HashKey(rawKey))
	if found == nil || !found.Active {
		t.Fatal("key should be active before revocation")
	}

	// Revoke.
	if err := st.RevokeAPIKey(ctx, key.ID); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}

	// After revocation, GetAPIKeyByHash must return nil (active=false).
	after, _ := st.GetAPIKeyByHash(ctx, HashKey(rawKey))
	if after != nil {
		t.Error("revoked key must not be returned by GetAPIKeyByHash")
	}
}

func TestIdempotentMigrations(t *testing.T) {
	// Regression: running migrations twice used to insert duplicate global
	// policies because NULL tenant_id is not caught by a standard UNIQUE
	// constraint. The partial index policies_global_name_uniq fixes this.
	st := openTestStore(t)
	ctx := context.Background()

	// Seed 3 default policies (same as 002_seed.sql).
	for _, p := range []struct{ name, effect, condition string }{
		{"Block High-Risk Requests", "DENY", "risk_score > 70"},
		{"GDPR EU Strict Mode", "ALLOW", `region == "EU"`},
		{"GPT-4 Admin Only", "DENY", `model == "gpt-4o"`},
	} {
		st.Pool().Exec(ctx, //nolint:errcheck
			`INSERT INTO policies(name,effect,principal,action,condition)
			 VALUES($1,$2,'*','InvokeLLM',$3)
			 ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING`,
			p.name, p.effect, p.condition)
	}

	// Run the same insert again (simulating a second migration run).
	for _, p := range []struct{ name, effect, condition string }{
		{"Block High-Risk Requests", "DENY", "risk_score > 70"},
		{"GDPR EU Strict Mode", "ALLOW", `region == "EU"`},
		{"GPT-4 Admin Only", "DENY", `model == "gpt-4o"`},
	} {
		st.Pool().Exec(ctx, //nolint:errcheck
			`INSERT INTO policies(name,effect,principal,action,condition)
			 VALUES($1,$2,'*','InvokeLLM',$3)
			 ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING`,
			p.name, p.effect, p.condition)
	}

	policies, err := st.ListPolicies(ctx, nil)
	if err != nil {
		t.Fatalf("ListPolicies: %v", err)
	}
	if len(policies) != 3 {
		t.Errorf("after two inserts of the same 3 global policies, count = %d; want 3 (duplicate bug)", len(policies))
	}
}

func TestInsertAuditBatch(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	tenant, _ := st.CreateTenant(ctx, "audit-tenant", "standard", 60)
	tid := tenant.ID

	rows := make([]AuditRow, 5)
	for i := range rows {
		rows[i] = AuditRow{
			EventID:    uuid.New().String(),
			RequestID:  uuid.New().String(),
			TenantID:   &tid,
			Action:     "ALLOWED",
			RiskScore:  float64(i),
			Path:       "/v1/chat/completions",
			LatencyMs:  int64(i * 10),
			StatusCode: 200,
			Region:     "US",
		}
	}

	if err := st.InsertAuditBatch(ctx, rows); err != nil {
		t.Fatalf("InsertAuditBatch: %v", err)
	}

	_, total, err := st.ListAuditEvents(ctx, &tid, 20, 0)
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if total < 5 {
		t.Errorf("audit_events count = %d; want >= 5", total)
	}
}

func TestInsertAuditBatch_Idempotent(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	tenant, _ := st.CreateTenant(ctx, "audit-idempotent", "standard", 60)
	tid := tenant.ID
	eventID := uuid.New().String()

	row := AuditRow{
		EventID:    eventID,
		RequestID:  uuid.New().String(),
		TenantID:   &tid,
		Action:     "ALLOWED",
		RiskScore:  5.0,
		Path:       "/v1/chat/completions",
		LatencyMs:  100,
		StatusCode: 200,
		Region:     "EU",
	}

	// Insert twice — simulates Kafka redelivery.
	if err := st.InsertAuditBatch(ctx, []AuditRow{row}); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if err := st.InsertAuditBatch(ctx, []AuditRow{row}); err != nil {
		t.Fatalf("second insert (should be idempotent): %v", err)
	}

	_, total, err := st.ListAuditEvents(ctx, &tid, 20, 0)
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if total != 1 {
		t.Errorf("got %d rows; want exactly 1 (duplicate must be ignored)", total)
	}
}
