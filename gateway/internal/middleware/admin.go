package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

// AdminTokenAuth protects machine-to-machine APIs with ADMIN_TOKEN. It accepts
// either X-Admin-Token or Authorization: Bearer <token>.
func AdminTokenAuth(token string) func(http.Handler) http.Handler {
	tokenSum := sha256.Sum256([]byte(token))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := adminTokenFromRequest(r)
			gotSum := sha256.Sum256([]byte(got))
			if token != "" && subtle.ConstantTimeCompare(gotSum[:], tokenSum[:]) == 1 {
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
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}
