package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/settings"
)

// settingsHandler serves the runtime-settings plane at /admin/v1/settings.
// Without a tenant query param it operates on the global document; with
// ?tenant=<uuid> it reads/writes that tenant's sparse override (layered over
// global at request time).
type settingsHandler struct{ mgr *settings.Manager }

// tenantParam returns the validated tenant UUID string, or "" for the global doc.
// The bool is false when a tenant param was given but is not a valid UUID.
func tenantParam(r *http.Request) (string, bool) {
	t := r.URL.Query().Get("tenant")
	if t == "" {
		return "", true
	}
	if _, err := uuid.Parse(t); err != nil {
		return "", false
	}
	return t, true
}

func (h *settingsHandler) getSettings(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settings unavailable"})
		return
	}
	tenant, ok := tenantParam(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant id"})
		return
	}
	if tenant == "" {
		writeJSON(w, http.StatusOK, redactSecrets(h.mgr.Get()))
		return
	}
	writeJSON(w, http.StatusOK, redactSecrets(h.mgr.GetForTenant(tenant)))
}

// redactSecrets blanks write-only secret fields before a settings document is
// returned to a client. The upstream API key is never exposed via the API;
// callers send it only when changing it.
func redactSecrets(s settings.Settings) settings.Settings {
	s.UpstreamAPIKey = ""
	s.AlertWebhookURL = "" // Slack/SIEM webhook URLs are secrets (bearer-in-URL)
	return s
}

// The upstream API key is authoritative when PRESENT in a patch: a value sets
// it, an empty string clears it (switching to a keyless local model). Callers
// that don't intend to change the key must OMIT the field — the JSON merge then
// preserves the stored value. (The dashboard omits it unless the user edits it.)

func (h *settingsHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settings unavailable"})
		return
	}
	tenant, ok := tenantParam(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant id"})
		return
	}
	patch, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unreadable body"})
		return
	}
	if !json.Valid(patch) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	var updated settings.Settings
	if tenant == "" {
		updated, err = h.mgr.Update(r.Context(), patch)
	} else {
		updated, err = h.mgr.UpdateForTenant(r.Context(), tenant, patch)
	}
	if err != nil {
		internalError(w, "update settings", err)
		return
	}
	writeJSON(w, http.StatusOK, redactSecrets(updated))
}

// deleteSettings clears a tenant's override, reverting it to the global doc.
func (h *settingsHandler) deleteSettings(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settings unavailable"})
		return
	}
	tenant, ok := tenantParam(r)
	if !ok || tenant == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant id required"})
		return
	}
	if err := h.mgr.ClearTenant(r.Context(), tenant); err != nil {
		internalError(w, "clear tenant settings", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reverted to global"})
}
