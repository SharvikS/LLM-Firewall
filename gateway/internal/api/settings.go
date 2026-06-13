package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/sharvik/llm-firewall/gateway/internal/settings"
)

// settingsHandler serves the runtime-settings plane at /admin/v1/settings.
type settingsHandler struct{ mgr *settings.Manager }

// getSettings returns the full current settings document.
func (h *settingsHandler) getSettings(w http.ResponseWriter, _ *http.Request) {
	if h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settings unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, h.mgr.Get())
}

// updateSettings merges a partial JSON patch, persists it, and applies it live.
// The full, clamped document is returned so the dashboard reflects normalized
// values immediately.
func (h *settingsHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "settings unavailable"})
		return
	}
	patch, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unreadable body"})
		return
	}
	// Validate JSON shape before handing to the manager for a clearer 400.
	if !json.Valid(patch) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	updated, err := h.mgr.Update(r.Context(), patch)
	if err != nil {
		internalError(w, "update settings", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
