// Package api provides the internal admin REST API at /admin/v1/*.
// All routes require the ADMIN_TOKEN header — this credential is used
// server-side only and must never be exposed to browsers via NEXT_PUBLIC_*.
package api

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// NewAdminRouter builds the /admin/v1 Chi sub-router.
func NewAdminRouter(st *store.Store, adminToken string) http.Handler {
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(adminAuth(adminToken))
	r.Use(corsHeaders)

	h := &adminHandler{st: st}

	// Tenants
	r.Get("/tenants",        h.listTenants)
	r.Post("/tenants",       h.createTenant)

	// API Keys
	r.Get("/keys",           h.listKeys)
	r.Post("/keys",          h.createKey)
	r.Delete("/keys/{id}",   h.revokeKey)

	// Policies
	r.Get("/policies",       h.listPolicies)
	r.Post("/policies",      h.createPolicy)
	r.Put("/policies/{id}",  h.updatePolicy)
	r.Delete("/policies/{id}", h.deletePolicy)

	// Audit logs
	r.Get("/audit",          h.listAudit)

	return r
}

// adminAuth gates every /admin/* route with the master token.
func adminAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := r.Header.Get("X-Admin-Token")
			if provided == "" {
				// Also accept Bearer for curl convenience
				provided = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			}
			if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin token"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-Admin-Token,Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type adminHandler struct{ st *store.Store }

// ── Tenants ──────────────────────────────────────────────────────────────────

func (h *adminHandler) listTenants(w http.ResponseWriter, r *http.Request) {
	tenants, err := h.st.ListTenants(r.Context())
	if err != nil {
		internalError(w, "list tenants", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tenants": tenants, "count": len(tenants)})
}

func (h *adminHandler) createTenant(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		Tier      string `json:"tier"`
		RateLimit int    `json:"rate_limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.Tier == "" {
		body.Tier = "standard"
	}
	if body.RateLimit == 0 {
		body.RateLimit = 60
	}
	t, err := h.st.CreateTenant(r.Context(), body.Name, body.Tier, body.RateLimit)
	if err != nil {
		internalError(w, "create tenant", err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// ── API Keys ─────────────────────────────────────────────────────────────────

func (h *adminHandler) listKeys(w http.ResponseWriter, r *http.Request) {
	var tenantID uuid.UUID
	if tid := r.URL.Query().Get("tenant_id"); tid != "" {
		if parsed, err := uuid.Parse(tid); err == nil {
			tenantID = parsed
		}
	}
	keys, err := h.st.ListAPIKeys(r.Context(), tenantID)
	if err != nil {
		internalError(w, "list keys", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys, "count": len(keys)})
}

func (h *adminHandler) createKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TenantID string `json:"tenant_id"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	tid, err := uuid.Parse(body.TenantID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant_id UUID"})
		return
	}
	rawKey, key, err := h.st.GenerateAPIKey(r.Context(), tid, body.Name)
	if err != nil {
		internalError(w, "generate key", err)
		return
	}
	// Raw key is returned ONCE — store it now; it cannot be recovered later.
	writeJSON(w, http.StatusCreated, map[string]any{
		"key":      rawKey, // shown once
		"metadata": key,
	})
}

func (h *adminHandler) revokeKey(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid key ID"})
		return
	}
	if err := h.st.RevokeAPIKey(r.Context(), id); err != nil {
		internalError(w, "revoke key", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// ── Policies ─────────────────────────────────────────────────────────────────

func (h *adminHandler) listPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := h.st.ListPolicies(r.Context(), nil)
	if err != nil {
		internalError(w, "list policies", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policies": policies, "count": len(policies)})
}

func (h *adminHandler) createPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TenantID    *string `json:"tenant_id"`
		Name        string  `json:"name"`
		Description string  `json:"description"`
		Effect      string  `json:"effect"`
		Principal   string  `json:"principal"`
		Action      string  `json:"action"`
		Condition   string  `json:"condition"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	inp := store.CreatePolicyInput{
		Name: body.Name, Description: body.Description,
		Effect: body.Effect, Principal: body.Principal,
		Action: body.Action, Condition: body.Condition,
	}
	if body.TenantID != nil {
		if parsed, err := uuid.Parse(*body.TenantID); err == nil {
			inp.TenantID = &parsed
		}
	}
	if inp.Principal == "" {
		inp.Principal = "*"
	}
	if inp.Action == "" {
		inp.Action = "*"
	}
	p, err := h.st.CreatePolicy(r.Context(), inp)
	if err != nil {
		internalError(w, "create policy", err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *adminHandler) updatePolicy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid policy ID"})
		return
	}
	var inp store.UpdatePolicyInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	p, err := h.st.UpdatePolicy(r.Context(), id, inp)
	if err != nil {
		internalError(w, "update policy", err)
		return
	}
	if p == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *adminHandler) deletePolicy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid policy ID"})
		return
	}
	if err := h.st.DeletePolicy(r.Context(), id); err != nil {
		internalError(w, "delete policy", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

// listAudit supports two pagination modes:
//
//	keyset (preferred): ?limit=50[&cursor=<opaque>] — O(limit) at any depth,
//	  stable under concurrent inserts; response carries next_cursor ("" = end).
//	offset (legacy):    ?limit=50&offset=100 — kept for existing dashboard
//	  callers; degrades linearly with depth.
//
// Presence of the cursor parameter (even empty: "cursor=") selects keyset mode.
func (h *adminHandler) listAudit(w http.ResponseWriter, r *http.Request) {
	limit := parseQueryInt(r, "limit", 50)
	if limit > 200 {
		limit = 200
	}

	if cursorStr, useCursor := cursorParam(r); useCursor {
		before, err := decodeAuditCursor(cursorStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid cursor"})
			return
		}
		rows, next, err := h.st.ListAuditEventsCursor(r.Context(), nil, limit, before)
		if err != nil {
			internalError(w, "list audit (cursor)", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"events": rows, "limit": limit, "next_cursor": encodeAuditCursor(next),
		})
		return
	}

	offset := parseQueryInt(r, "offset", 0)
	rows, total, err := h.st.ListAuditEvents(r.Context(), nil, limit, offset)
	if err != nil {
		internalError(w, "list audit", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events": rows, "total": total, "limit": limit, "offset": offset,
	})
}

// cursorParam reports whether the request opted into keyset pagination and
// returns the raw cursor value (empty string = first page).
func cursorParam(r *http.Request) (string, bool) {
	if !r.URL.Query().Has("cursor") {
		return "", false
	}
	return r.URL.Query().Get("cursor"), true
}

// encodeAuditCursor packs a cursor as base64url("RFC3339Nano|uuid").
// A nil cursor (no more pages) encodes to "".
func encodeAuditCursor(c *store.AuditCursor) string {
	if c == nil {
		return ""
	}
	raw := c.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + c.ID.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeAuditCursor reverses encodeAuditCursor; "" means first page (nil).
func decodeAuditCursor(s string) (*store.AuditCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("malformed cursor")
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, err
	}
	return &store.AuditCursor{CreatedAt: ts, ID: id}, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body) //nolint:errcheck
}

func internalError(w http.ResponseWriter, op string, err error) {
	logger.Get().Error("admin API error",
		slog.String("op", op),
		slog.String("error", err.Error()),
	)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
}

func parseQueryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}
