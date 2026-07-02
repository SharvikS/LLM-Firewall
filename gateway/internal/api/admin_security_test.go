package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/auth"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
	"github.com/sharvik/llm-firewall/gateway/internal/testhelper"
)

func TestAdminRouterRejectsUntrustedOrigin(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	router := NewAdminRouter(AdminDeps{
		Store:          st,
		MasterToken:    "master-token",
		Issuer:         auth.NewIssuer("test-secret", time.Hour),
		AllowedOrigins: []string{"http://dashboard.local"},
	})

	req := httptest.NewRequest(http.MethodOptions, "/auth/status", nil)
	req.Header.Set("Origin", "http://evil.local")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("untrusted origin status = %d; want 403", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("untrusted origin ACAO = %q; want empty", got)
	}

	req = httptest.NewRequest(http.MethodOptions, "/auth/status", nil)
	req.Header.Set("Origin", "http://dashboard.local")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("trusted origin status = %d; want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://dashboard.local" {
		t.Fatalf("trusted origin ACAO = %q", got)
	}
}

func TestSSOExchangeRequiresMachineTokenAndConsumesCode(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	ctx := context.Background()
	issuer := auth.NewIssuer("test-secret", time.Hour)
	user := createTestUser(t, st, "sso-exchange@titan.local", auth.RoleViewer)
	if err := st.CreateSSOExchangeCode(ctx, "handoff-code", user.ID, user.Email, user.Role, time.Minute); err != nil {
		t.Fatalf("CreateSSOExchangeCode: %v", err)
	}
	router := NewAdminRouter(AdminDeps{
		Store:          st,
		MasterToken:    "master-token",
		Issuer:         issuer,
		AllowedOrigins: []string{"http://dashboard.local"},
	})

	body := []byte(`{"code":"handoff-code"}`)
	req := httptest.NewRequest(http.MethodPost, "/auth/sso/exchange", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("exchange without machine token = %d; want 401", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/auth/sso/exchange", bytes.NewReader(body))
	req.Header.Set("X-Admin-Token", "master-token")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("exchange with machine token = %d; body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil || out.Token == "" {
		t.Fatalf("exchange response token missing: %v / %+v", err, out)
	}
	if _, err := issuer.Verify(out.Token, time.Now()); err != nil {
		t.Fatalf("issued token did not verify: %v", err)
	}

	req = httptest.NewRequest(http.MethodPost, "/auth/sso/exchange", bytes.NewReader(body))
	req.Header.Set("X-Admin-Token", "master-token")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("second exchange status = %d; want 401", rec.Code)
	}
}

func TestTenantScopedAdminCannotReadOrMutateOtherTenants(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	ctx := context.Background()
	tenantA, err := st.CreateTenant(ctx, "tenant-scope-a", "standard", 60)
	if err != nil {
		t.Fatalf("CreateTenant A: %v", err)
	}
	tenantB, err := st.CreateTenant(ctx, "tenant-scope-b", "standard", 60)
	if err != nil {
		t.Fatalf("CreateTenant B: %v", err)
	}
	if _, _, err := st.GenerateAPIKey(ctx, tenantA.ID, "key-a"); err != nil {
		t.Fatalf("GenerateAPIKey A: %v", err)
	}
	if _, _, err := st.GenerateAPIKey(ctx, tenantB.ID, "key-b"); err != nil {
		t.Fatalf("GenerateAPIKey B: %v", err)
	}
	user := createTestUser(t, st, "scoped-admin@titan.local", auth.RoleAdmin)
	if err := st.SetUserTenantAccess(ctx, user.ID, []uuid.UUID{tenantA.ID}); err != nil {
		t.Fatalf("SetUserTenantAccess: %v", err)
	}
	issuer := auth.NewIssuer("test-secret", time.Hour)
	token, err := issuer.Issue(user.ID.String(), user.Email, auth.Role(user.Role), time.Now())
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	router := NewAdminRouter(AdminDeps{
		Store:          st,
		MasterToken:    "master-token",
		Issuer:         issuer,
		AllowedOrigins: []string{"http://dashboard.local"},
	})

	req := httptest.NewRequest(http.MethodGet, "/keys", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped key list = %d; body=%s", rec.Code, rec.Body.String())
	}
	var keysResp struct {
		Keys []store.APIKey `json:"keys"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&keysResp); err != nil {
		t.Fatalf("decode keys: %v", err)
	}
	if len(keysResp.Keys) != 1 || keysResp.Keys[0].TenantID != tenantA.ID {
		t.Fatalf("scoped keys = %+v; want only tenant A", keysResp.Keys)
	}

	req = httptest.NewRequest(http.MethodGet, "/keys?tenant_id="+tenantB.ID.String(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-tenant key read = %d; want 403", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/tenants", bytes.NewReader([]byte(`{"name":"forbidden","tier":"standard","rate_limit":60}`)))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("scoped admin tenant create = %d; want 403", rec.Code)
	}
}

func createTestUser(t *testing.T, st *store.Store, email string, role auth.Role) *store.User {
	t.Helper()
	hash, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser(context.Background(), email, hash, string(role), "local")
	if err != nil {
		t.Fatalf("CreateUser(%s): %v", email, err)
	}
	return user
}
