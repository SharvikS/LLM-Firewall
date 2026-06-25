package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

type contextKey string

const AuthCtxKey contextKey = "titan_auth"

type APIKeyAuthStore interface {
	GetAPIKeyByHash(ctx context.Context, hash string) (*store.APIKey, error)
	GetTenantByID(ctx context.Context, id uuid.UUID) (*store.Tenant, error)
	TouchAPIKey(keyID uuid.UUID)
}

// AuthContext carries the resolved identity for a request.
// Set by APIKeyAuth and consumed by the proxy and audit layer.
type AuthContext struct {
	TenantID     uuid.UUID
	TenantName   string
	Tier         string // plan tier — drives billing quota enforcement
	APIKeyID     uuid.UUID
	RateLimitRPM int
	Sandbox      store.APISandbox
}

type authCacheEntry struct {
	auth      AuthContext
	expiresAt time.Time
}

type authCache struct {
	ttl     time.Duration
	mu      sync.Mutex
	entries map[string]authCacheEntry
}

func newAuthCache(ttl time.Duration) *authCache {
	if ttl <= 0 {
		return nil
	}
	return &authCache{
		ttl:     ttl,
		entries: make(map[string]authCacheEntry),
	}
}

func (c *authCache) get(hash string) (AuthContext, bool) {
	if c == nil {
		return AuthContext{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[hash]
	if !ok {
		return AuthContext{}, false
	}
	if !entry.expiresAt.After(time.Now()) {
		delete(c.entries, hash)
		return AuthContext{}, false
	}
	return entry.auth, true
}

func (c *authCache) set(hash string, auth AuthContext) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[hash] = authCacheEntry{auth: auth, expiresAt: time.Now().Add(c.ttl)}
}

// APIKeyAuth is a Chi middleware that validates the incoming Bearer token
// against the api_keys table (fail-closed: no key = 401, invalid key = 401).
func APIKeyAuth(st APIKeyAuthStore) func(http.Handler) http.Handler {
	return APIKeyAuthWithCache(st, 0)
}

// APIKeyAuthWithCache validates Bearer tokens and caches successful key+tenant
// resolutions for ttl. It never caches misses or DB errors, so invalid keys
// remain fail-closed and new keys become usable immediately.
func APIKeyAuthWithCache(st APIKeyAuthStore, ttl time.Duration) func(http.Handler) http.Handler {
	cache := newAuthCache(ttl)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := extractBearer(r)
			if raw == "" {
				writeAuthError(w, "API key required — provide a Bearer token")
				return
			}

			hash := store.HashKey(raw)
			if authCtx, ok := cache.get(hash); ok {
				go st.TouchAPIKey(authCtx.APIKeyID)
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), AuthCtxKey, authCtx)))
				return
			}

			apiKey, err := st.GetAPIKeyByHash(r.Context(), hash)
			if err != nil {
				logger.Get().Error("auth: DB lookup failed",
					slog.String("error", err.Error()))
				writeAuthError(w, "Authentication service unavailable")
				return
			}
			if apiKey == nil {
				logger.Get().Warn("auth: invalid or inactive key",
					slog.String("key_prefix", safePrefix(raw)))
				writeAuthError(w, "Invalid or revoked API key")
				return
			}

			tenant, err := st.GetTenantByID(r.Context(), apiKey.TenantID)
			if err != nil || tenant == nil {
				logger.Get().Warn("auth: tenant lookup failed",
					slog.String("key_id", apiKey.ID.String()))
				writeAuthError(w, "Tenant not found or inactive")
				return
			}

			// Fire-and-forget: update last_used, increment request count.
			go st.TouchAPIKey(apiKey.ID)

			authCtx := AuthContext{
				TenantID:     tenant.ID,
				TenantName:   tenant.Name,
				Tier:         tenant.Tier,
				APIKeyID:     apiKey.ID,
				RateLimitRPM: tenant.RateLimitRPM,
				Sandbox:      apiKey.Sandbox,
			}
			cache.set(hash, authCtx)
			ctx := context.WithValue(r.Context(), AuthCtxKey, authCtx)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetAuthContext retrieves the resolved identity from a request context.
// Returns a zero-value AuthContext (TenantID == uuid.Nil) if auth middleware
// was not applied.
func GetAuthContext(ctx context.Context) AuthContext {
	if v, ok := ctx.Value(AuthCtxKey).(AuthContext); ok {
		return v
	}
	return AuthContext{}
}

func extractBearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(auth, "Bearer ")
}

func safePrefix(raw string) string {
	if len(raw) > 8 {
		return raw[:8] + "…"
	}
	return raw
}

func writeAuthError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "Bearer realm=\"titan-gateway\"")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"error": map[string]any{
			"message": msg,
			"type":    "authentication_error",
			"code":    401,
		},
	})
}
