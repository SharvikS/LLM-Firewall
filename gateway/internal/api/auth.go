package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/auth"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// identityKey carries the authenticated Identity through the request context.
type identityKey struct{}

// Identity is the resolved caller (a human session or the machine master token).
type Identity struct {
	UserID  string
	Email   string
	Role    auth.Role
	Machine bool
}

func identityFrom(ctx context.Context) Identity {
	if v, ok := ctx.Value(identityKey{}).(Identity); ok {
		return v
	}
	return Identity{}
}

// authHandler serves the public auth endpoints (login, SSO).
type authHandler struct {
	st          *store.Store
	issuer      *auth.Issuer
	oidc        *auth.OIDCClient
	oidcEnabled bool
	defaultRole auth.Role
	dashboardURL string // where to bounce back after SSO
}

// login validates email/password and returns a session JWT.
func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	cred, err := h.st.GetUserCredByEmail(r.Context(), body.Email)
	if err != nil {
		internalError(w, "login lookup", err)
		return
	}
	// Always run a bcrypt comparison to keep timing uniform whether or not the
	// user exists (mitigates user-enumeration via response time).
	ok := false
	if cred != nil && !cred.Disabled && cred.AuthProvider == "local" {
		ok = auth.CheckPassword(cred.PasswordHash, body.Password)
	} else {
		auth.CheckPassword("$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv", body.Password)
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	token, err := h.issuer.Issue(cred.ID.String(), cred.Email, auth.Role(cred.Role), time.Now())
	if err != nil {
		internalError(w, "issue token", err)
		return
	}
	go h.st.TouchLastLogin(context.Background(), cred.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  map[string]string{"email": cred.Email, "role": cred.Role},
	})
}

// me returns the current identity (from the authenticate middleware).
func (h *authHandler) me(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"email":   id.Email,
		"role":    id.Role,
		"machine": id.Machine,
	})
}

// authStatus reports whether SSO is available (used by the login page).
func (h *authHandler) authStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"oidc_enabled": h.oidcEnabled})
}

// oidcLogin redirects the browser to the identity provider.
func (h *authHandler) oidcLogin(w http.ResponseWriter, r *http.Request) {
	if !h.oidcEnabled {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "SSO not configured"})
		return
	}
	authURL, err := h.oidc.AuthCodeURL(r.Context(), time.Now())
	if err != nil {
		logger.Get().Error("oidc authcode url", slog.String("error", err.Error()))
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "identity provider unreachable"})
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

// oidcCallback completes the code exchange, provisions the user, mints a session
// token and bounces back to the dashboard with the token in the URL fragment so
// the dashboard can store it as an httpOnly cookie.
func (h *authHandler) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if !h.oidcEnabled {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "SSO not configured"})
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing code"})
		return
	}
	email, err := h.oidc.Exchange(r.Context(), code, state, time.Now())
	if err != nil {
		logger.Get().Warn("oidc exchange failed", slog.String("error", err.Error()))
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "SSO sign-in failed"})
		return
	}
	cred, err := h.st.UpsertOIDCUser(r.Context(), strings.ToLower(email), string(h.defaultRole))
	if err != nil {
		internalError(w, "oidc upsert", err)
		return
	}
	if cred.Disabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "account disabled"})
		return
	}
	token, err := h.issuer.Issue(cred.ID.String(), cred.Email, auth.Role(cred.Role), time.Now())
	if err != nil {
		internalError(w, "issue token", err)
		return
	}
	// Hand the token to the dashboard's SSO landing route, which sets the cookie.
	dest := strings.TrimRight(h.dashboardURL, "/") + "/login/sso?token=" + url.QueryEscape(token)
	http.Redirect(w, r, dest, http.StatusFound)
}

// ── RBAC middleware ───────────────────────────────────────────────────────────

// authenticate resolves an Identity from the master token (machine → admin) or a
// session JWT, else 401. Public auth routes are mounted outside this middleware.
func authenticate(issuer *auth.Issuer, masterToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			xAdmin := r.Header.Get("X-Admin-Token")
			bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")

			// 1. Machine master token (X-Admin-Token, or Bearer for curl) → admin.
			candidate := xAdmin
			if candidate == "" {
				candidate = bearer
			}
			if masterToken != "" && subtle.ConstantTimeCompare([]byte(candidate), []byte(masterToken)) == 1 {
				ctx := context.WithValue(r.Context(), identityKey{}, Identity{Email: "machine", Role: auth.RoleAdmin, Machine: true})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// 2. Human session JWT in Authorization: Bearer.
			if bearer != "" && issuer != nil {
				if claims, err := issuer.Verify(bearer, time.Now()); err == nil {
					ctx := context.WithValue(r.Context(), identityKey{}, Identity{UserID: claims.Sub, Email: claims.Email, Role: claims.Role})
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		})
	}
}

// requireRole enforces a minimum role on a route. Must run after authenticate.
func requireRole(min auth.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := identityFrom(r.Context())
			if !id.Role.AtLeast(min) {
				writeJSON(w, http.StatusForbidden, map[string]string{
					"error": "insufficient role: this action requires " + string(min),
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
