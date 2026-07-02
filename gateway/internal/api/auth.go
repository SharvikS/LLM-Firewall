package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/auth"
	"github.com/sharvik/llm-firewall/gateway/internal/edition"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// identityKey carries the authenticated Identity through the request context.
type identityKey struct{}

// Identity is the resolved caller (a human session or the machine master token).
type Identity struct {
	UserID    string
	Email     string
	Role      auth.Role
	Machine   bool
	Global    bool
	TenantIDs []uuid.UUID
}

func identityFrom(ctx context.Context) Identity {
	if v, ok := ctx.Value(identityKey{}).(Identity); ok {
		return v
	}
	return Identity{}
}

// authHandler serves the public auth endpoints (login, SSO).
type authHandler struct {
	st           *store.Store
	issuer       *auth.Issuer
	oidc         *auth.OIDCClient
	oidcEnabled  bool
	defaultRole  auth.Role
	dashboardURL string // where to bounce back after SSO
	audit        *auditRecorder
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
		h.audit.Record(r, controlAuditEvent{
			Action: "AUTH_LOGIN_FAILED", StatusCode: http.StatusUnauthorized,
			Reason: "invalid credentials", ActorEmail: body.Email, ActorType: "human",
		})
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	token, err := h.issuer.Issue(cred.ID.String(), cred.Email, auth.Role(cred.Role), time.Now())
	if err != nil {
		internalError(w, "issue token", err)
		return
	}
	go h.st.TouchLastLogin(context.Background(), cred.ID)
	h.audit.Record(r, controlAuditEvent{
		Action: "AUTH_LOGIN_SUCCEEDED", ActorEmail: cred.Email, ActorID: cred.ID.String(),
		ActorRole: cred.Role, ActorType: "human", TargetType: "user", TargetID: cred.ID.String(),
		Reason: "local login succeeded",
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  map[string]string{"email": cred.Email, "role": cred.Role},
	})
}

// me returns the current identity (from the authenticate middleware).
func (h *authHandler) me(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	tenantIDs := make([]string, 0, len(id.TenantIDs))
	for _, tid := range id.TenantIDs {
		tenantIDs = append(tenantIDs, tid.String())
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"email":      id.Email,
		"role":       id.Role,
		"machine":    id.Machine,
		"global":     id.Global,
		"tenant_ids": tenantIDs,
		"edition":    string(edition.Current()),
		"features":   edition.Entitled(),
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

// oidcCallback completes the provider code exchange, provisions the user, and
// bounces back to the dashboard with a one-time TITAN handoff code.
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
	identity, err := h.oidc.Exchange(r.Context(), code, state, time.Now())
	if err != nil {
		logger.Get().Warn("oidc exchange failed", slog.String("error", err.Error()))
		h.audit.Record(r, controlAuditEvent{
			Action: "AUTH_SSO_FAILED", StatusCode: http.StatusUnauthorized,
			Reason: "SSO sign-in failed: " + err.Error(), ActorType: "human",
		})
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "SSO sign-in failed"})
		return
	}
	role := h.defaultRole
	if identity.Role.Valid() {
		role = identity.Role
	}
	cred, err := h.st.UpsertOIDCUser(r.Context(), identity.Email, identity.Subject, string(role))
	if err != nil {
		h.audit.Record(r, controlAuditEvent{
			Action: "AUTH_SSO_FAILED", StatusCode: http.StatusUnauthorized,
			Reason: "SSO provisioning failed: " + err.Error(), ActorEmail: identity.Email, ActorType: "human",
		})
		internalError(w, "oidc upsert", err)
		return
	}
	if cred.Disabled {
		h.audit.Record(r, controlAuditEvent{
			Action: "AUTH_SSO_FAILED", StatusCode: http.StatusForbidden,
			Reason: "account disabled", ActorEmail: cred.Email, ActorID: cred.ID.String(),
			ActorRole: cred.Role, ActorType: "human", TargetType: "user", TargetID: cred.ID.String(),
		})
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "account disabled"})
		return
	}
	go h.st.TouchLastLogin(context.Background(), cred.ID)
	h.audit.Record(r, controlAuditEvent{
		Action: "AUTH_SSO_SUCCEEDED", ActorEmail: cred.Email, ActorID: cred.ID.String(),
		ActorRole: cred.Role, ActorType: "human", TargetType: "user", TargetID: cred.ID.String(),
		Reason: "OIDC SSO succeeded",
	})
	handoffCode, err := newExchangeCode()
	if err != nil {
		internalError(w, "sso exchange code", err)
		return
	}
	if err := h.st.CreateSSOExchangeCode(r.Context(), handoffCode, cred.ID, cred.Email, cred.Role, 90*time.Second); err != nil {
		internalError(w, "store sso exchange code", err)
		return
	}
	// Hand the browser a one-time code only. The dashboard backend redeems it
	// with the machine token, so the session JWT never appears in URLs.
	dest := strings.TrimRight(h.dashboardURL, "/") + "/api/auth/sso?code=" + url.QueryEscape(handoffCode)
	http.Redirect(w, r, dest, http.StatusFound)
}

// ssoExchange redeems the one-time OIDC handoff code for a session JWT. It is
// machine-token protected by route middleware and called only by the dashboard
// backend, never directly from browser JavaScript.
func (h *authHandler) ssoExchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Code = strings.TrimSpace(body.Code)
	if body.Code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing code"})
		return
	}
	exchange, err := h.st.ConsumeSSOExchangeCode(r.Context(), body.Code)
	if err != nil {
		internalError(w, "consume sso exchange code", err)
		return
	}
	if exchange == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired SSO code"})
		return
	}
	token, err := h.issuer.Issue(exchange.UserID.String(), exchange.Email, auth.Role(exchange.Role), time.Now())
	if err != nil {
		internalError(w, "issue token", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  map[string]string{"email": exchange.Email, "role": exchange.Role},
	})
}

func newExchangeCode() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ── RBAC middleware ───────────────────────────────────────────────────────────

// authenticate resolves an Identity from the master token (machine → admin) or a
// session JWT, else 401. Public auth routes are mounted outside this middleware.
func authenticate(issuer *auth.Issuer, masterToken string, st *store.Store) func(http.Handler) http.Handler {
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
				ctx := context.WithValue(r.Context(), identityKey{}, Identity{Email: "machine", Role: auth.RoleAdmin, Machine: true, Global: true})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// 2. Human session JWT in Authorization: Bearer.
			if bearer != "" && issuer != nil {
				if claims, err := issuer.Verify(bearer, time.Now()); err == nil {
					id := Identity{UserID: claims.Sub, Email: claims.Email, Role: claims.Role}
					if uid, parseErr := uuid.Parse(claims.Sub); parseErr == nil && st != nil {
						tenantIDs, err := st.ListUserTenantIDs(r.Context(), uid)
						if err != nil {
							logger.Get().Warn("auth: tenant scope lookup failed",
								slog.String("user_id", claims.Sub),
								slog.String("error", err.Error()))
							writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication service unavailable"})
							return
						}
						id.TenantIDs = tenantIDs
					}
					id.Global = len(id.TenantIDs) == 0
					ctx := context.WithValue(r.Context(), identityKey{}, id)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		})
	}
}

func machineOnly(masterToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			candidate := r.Header.Get("X-Admin-Token")
			if candidate == "" {
				candidate = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			}
			if masterToken != "" && subtle.ConstantTimeCompare([]byte(candidate), []byte(masterToken)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "machine authentication required"})
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

func requireGlobalAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := identityFrom(r.Context())
		if !id.Role.AtLeast(auth.RoleAdmin) {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "insufficient role: this action requires admin",
			})
			return
		}
		if !id.Global {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "global admin scope required",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
