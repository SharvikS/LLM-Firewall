package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/middleware"
)

func TestAdminTokenAuthRequiresToken(t *testing.T) {
	called := false
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)

	middleware.AdminTokenAuth("secret")(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401", rr.Code)
	}
	if called {
		t.Fatal("downstream must not be called without token")
	}
}

func TestAdminTokenAuthRejectsInvalidToken(t *testing.T) {
	called := false
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.Header.Set("X-Admin-Token", "wrong")

	middleware.AdminTokenAuth("secret")(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401", rr.Code)
	}
	if called {
		t.Fatal("downstream must not be called with invalid token")
	}
}

func TestAdminTokenAuthAcceptsAdminHeader(t *testing.T) {
	called := false
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.Header.Set("X-Admin-Token", "secret")

	middleware.AdminTokenAuth("secret")(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rr.Code)
	}
	if !called {
		t.Fatal("downstream must be called with valid token")
	}
}

func TestAdminTokenAuthAcceptsBearerToken(t *testing.T) {
	called := false
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.Header.Set("Authorization", "Bearer secret")

	middleware.AdminTokenAuth("secret")(downstream(&called)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rr.Code)
	}
	if !called {
		t.Fatal("downstream must be called with bearer token")
	}
}
