package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

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

type fakeAuthStore struct {
	mu sync.Mutex

	hash   string
	key    *store.APIKey
	tenant *store.Tenant

	getKeyCalls    int
	getTenantCalls int
	touches        int
}

func newFakeAuthStore(rawKey string) *fakeAuthStore {
	tenantID := uuid.New()
	keyID := uuid.New()
	return &fakeAuthStore{
		hash: store.HashKey(rawKey),
		key: &store.APIKey{
			ID:       keyID,
			TenantID: tenantID,
			Active:   true,
		},
		tenant: &store.Tenant{
			ID:           tenantID,
			Name:         "cached-auth-tenant",
			Tier:         "standard",
			RateLimitRPM: 600,
			Active:       true,
		},
	}
}

func (f *fakeAuthStore) GetAPIKeyByHash(_ context.Context, hash string) (*store.APIKey, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getKeyCalls++
	if f.key == nil || !f.key.Active || hash != f.hash {
		return nil, nil
	}
	key := *f.key
	return &key, nil
}

func (f *fakeAuthStore) GetTenantByID(_ context.Context, id uuid.UUID) (*store.Tenant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getTenantCalls++
	if f.tenant == nil || !f.tenant.Active || id != f.tenant.ID {
		return nil, nil
	}
	tenant := *f.tenant
	return &tenant, nil
}

func (f *fakeAuthStore) TouchAPIKey(uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.touches++
}

func (f *fakeAuthStore) counts() (keyCalls, tenantCalls, touches int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.getKeyCalls, f.getTenantCalls, f.touches
}

func requestWithKey(rawKey string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	return req
}

func serveAuth(mw func(http.Handler) http.Handler, rawKey string) int {
	called := false
	rr := httptest.NewRecorder()
	mw(downstream(&called)).ServeHTTP(rr, requestWithKey(rawKey))
	if rr.Code == http.StatusOK && !called {
		return 0
	}
	return rr.Code
}

func waitForTouches(t *testing.T, f *fakeAuthStore, want int) {
	t.Helper()
	deadline := time.Now().Add(500 * time.Millisecond)
	for {
		_, _, touches := f.counts()
		if touches >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("touches = %d; want at least %d", touches, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestAPIKeyAuthWithCache_CachesPositiveLookup(t *testing.T) {
	rawKey := "titan_cached_key"
	fake := newFakeAuthStore(rawKey)
	mw := middleware.APIKeyAuthWithCache(fake, time.Minute)

	if code := serveAuth(mw, rawKey); code != http.StatusOK {
		t.Fatalf("first request status = %d; want 200", code)
	}
	if code := serveAuth(mw, rawKey); code != http.StatusOK {
		t.Fatalf("second request status = %d; want 200", code)
	}
	waitForTouches(t, fake, 2)

	keyCalls, tenantCalls, touches := fake.counts()
	if keyCalls != 1 {
		t.Fatalf("GetAPIKeyByHash calls = %d; want 1", keyCalls)
	}
	if tenantCalls != 1 {
		t.Fatalf("GetTenantByID calls = %d; want 1", tenantCalls)
	}
	if touches != 2 {
		t.Fatalf("TouchAPIKey calls = %d; want 2", touches)
	}
}

func TestAPIKeyAuthWithCache_DisabledTTLAlwaysLooksUp(t *testing.T) {
	rawKey := "titan_uncached_key"
	fake := newFakeAuthStore(rawKey)
	mw := middleware.APIKeyAuthWithCache(fake, 0)

	_ = serveAuth(mw, rawKey)
	_ = serveAuth(mw, rawKey)

	keyCalls, tenantCalls, _ := fake.counts()
	if keyCalls != 2 {
		t.Fatalf("GetAPIKeyByHash calls = %d; want 2", keyCalls)
	}
	if tenantCalls != 2 {
		t.Fatalf("GetTenantByID calls = %d; want 2", tenantCalls)
	}
}

func TestAPIKeyAuthWithCache_ExpiresPositiveLookup(t *testing.T) {
	rawKey := "titan_expiring_key"
	fake := newFakeAuthStore(rawKey)
	mw := middleware.APIKeyAuthWithCache(fake, 5*time.Millisecond)

	_ = serveAuth(mw, rawKey)
	time.Sleep(20 * time.Millisecond)
	_ = serveAuth(mw, rawKey)

	keyCalls, tenantCalls, _ := fake.counts()
	if keyCalls != 2 {
		t.Fatalf("GetAPIKeyByHash calls = %d; want 2 after cache expiry", keyCalls)
	}
	if tenantCalls != 2 {
		t.Fatalf("GetTenantByID calls = %d; want 2 after cache expiry", tenantCalls)
	}
}

func TestAPIKeyAuthWithCache_DoesNotCacheInvalidKeys(t *testing.T) {
	rawKey := "titan_valid_but_not_used"
	fake := newFakeAuthStore(rawKey)
	mw := middleware.APIKeyAuthWithCache(fake, time.Minute)

	if code := serveAuth(mw, "titan_invalid_key"); code != http.StatusUnauthorized {
		t.Fatalf("first invalid request status = %d; want 401", code)
	}
	if code := serveAuth(mw, "titan_invalid_key"); code != http.StatusUnauthorized {
		t.Fatalf("second invalid request status = %d; want 401", code)
	}

	keyCalls, tenantCalls, touches := fake.counts()
	if keyCalls != 2 {
		t.Fatalf("invalid key lookup calls = %d; want 2", keyCalls)
	}
	if tenantCalls != 0 {
		t.Fatalf("tenant lookups for invalid key = %d; want 0", tenantCalls)
	}
	if touches != 0 {
		t.Fatalf("touches for invalid key = %d; want 0", touches)
	}
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
