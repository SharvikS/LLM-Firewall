package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

type contextKey string

const AuthCtxKey contextKey = "titan_auth"

// AuthContext carries the resolved identity for a request.
// Set by APIKeyAuth and consumed by the proxy and audit layer.
type AuthContext struct {
	TenantID     uuid.UUID
	TenantName   string
	APIKeyID     uuid.UUID
	RateLimitRPM int
}

// APIKeyAuth is a Chi middleware that validates the incoming Bearer token
// against the api_keys table (fail-closed: no key = 401, invalid key = 401).
func APIKeyAuth(st *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := extractBearer(r)
			if raw == "" {
				writeAuthError(w, "API key required — provide a Bearer token")
				return
			}

			hash := store.HashKey(raw)
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

			ctx := context.WithValue(r.Context(), AuthCtxKey, AuthContext{
				TenantID:     tenant.ID,
				TenantName:   tenant.Name,
				APIKeyID:     apiKey.ID,
				RateLimitRPM: tenant.RateLimitRPM,
			})
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
