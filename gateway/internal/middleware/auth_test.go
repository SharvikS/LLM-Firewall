package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// ── Fail-closed auth integration test (real titan_test DB) ───────────────────

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	const dsn = "postgresql://localhost/titan_test?sslmode=disable"
	st, err := store.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("titan_test DB unavailable (%v) — skipping auth integration tests", err)
	}
	t.Cleanup(func() {
		st.Pool().Exec(context.Background(), //nolint:errcheck
			`TRUNCATE api_keys, policies, audit_events, tenants RESTART IDENTITY CASCADE`)
		st.Close()
	})
	return st
}

func seedKey(t *testing.T, st *store.Store) (rawKey string) {
	t.Helper()
	ctx := context.Background()
	tenant, err := st.CreateTenant(ctx, "auth-test-tenant", "standard", 60)
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	rawKey, _, err = st.GenerateAPIKey(ctx, tenant.ID, "Auth Test Key")
	if err != nil {
		t.Fatalf("seed key: %v", err)
	}
	return rawKey
}

// downstream records whether it was called.
func downstream(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

func TestAPIKeyAuth_NoHeader_Returns401(t *testing.T) {
	st := openTestStore(t)
	mw := middleware.APIKeyAuth(st)

	called := false
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	rr := httptest.NewRecorder()
	mw(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("no-key request: status = %d; want 401", rr.Code)
	}
	if called {
		t.Error("downstream handler must not be called on 401")
	}
}

func TestAPIKeyAuth_InvalidKey_Returns401(t *testing.T) {
	st := openTestStore(t)
	mw := middleware.APIKeyAuth(st)

	called := false
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer titan_totally_invalid_key_xyz")
	rr := httptest.NewRecorder()
	mw(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("invalid-key request: status = %d; want 401", rr.Code)
	}
	if called {
		t.Error("downstream must not be called on invalid key")
	}
}

func TestAPIKeyAuth_ValidKey_CallsDownstream(t *testing.T) {
	st := openTestStore(t)
	rawKey := seedKey(t, st)
	mw := middleware.APIKeyAuth(st)

	called := false
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rr := httptest.NewRecorder()
	mw(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("valid-key request: status = %d; want 200", rr.Code)
	}
	if !called {
		t.Error("downstream must be called on valid key")
	}
}

func TestAPIKeyAuth_ValidKey_SetsAuthContext(t *testing.T) {
	st := openTestStore(t)
	rawKey := seedKey(t, st)
	mw := middleware.APIKeyAuth(st)

	var capturedAuth middleware.AuthContext
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = middleware.GetAuthContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rr := httptest.NewRecorder()
	mw(handler).ServeHTTP(rr, req)

	if capturedAuth.TenantID == uuid.Nil {
		t.Error("AuthContext.TenantID must be set for a valid key")
	}
	if capturedAuth.APIKeyID == uuid.Nil {
		t.Error("AuthContext.APIKeyID must be set for a valid key")
	}
	if capturedAuth.TenantName == "" {
		t.Error("AuthContext.TenantName must not be empty")
	}
}

func TestAPIKeyAuth_RevokedKey_Returns401(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	// Generate and immediately revoke.
	tenant, _ := st.CreateTenant(ctx, "revoke-auth-tenant", "standard", 60)
	rawKey, key, _ := st.GenerateAPIKey(ctx, tenant.ID, "Revoked Key")
	st.RevokeAPIKey(ctx, key.ID) //nolint:errcheck

	mw := middleware.APIKeyAuth(st)
	called := false
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rr := httptest.NewRecorder()
	mw(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("revoked key: status = %d; want 401", rr.Code)
	}
	if called {
		t.Error("downstream must not be called with a revoked key")
	}
}

func TestAPIKeyAuth_ErrorResponseIsOpenAIJSON(t *testing.T) {
	st := openTestStore(t)
	mw := middleware.APIKeyAuth(st)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	rr := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})).ServeHTTP(rr, req)

	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q; want application/json", ct)
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d; want 401", rr.Code)
	}
}
