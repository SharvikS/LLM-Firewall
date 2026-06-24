package middleware

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

// AdminTokenAuth protects machine-to-machine read APIs with the configured
// ADMIN_TOKEN. It accepts either X-Admin-Token or Authorization: Bearer <token>.
func AdminTokenAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token != "" && subtle.ConstantTimeCompare([]byte(adminTokenFromRequest(r)), []byte(token)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
				"error": map[string]any{
					"message": "admin token required",
					"type":    "authentication_error",
					"code":    http.StatusUnauthorized,
				},
			})
		})
	}
}

func adminTokenFromRequest(r *http.Request) string {
	if token := r.Header.Get("X-Admin-Token"); token != "" {
		return token
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}
