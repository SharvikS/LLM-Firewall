package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/sharvik/llm-firewall/gateway/internal/alerts"
	"github.com/sharvik/llm-firewall/gateway/internal/settings"
)

// alertsHandler lets an operator verify SOC webhook wiring from the dashboard.
type alertsHandler struct {
	dispatcher *alerts.Dispatcher
	mgr        *settings.Manager
}

// sendTest delivers a synthetic alert to the configured (or supplied) webhook and
// reports success/failure so the operator gets immediate feedback.
func (h *alertsHandler) sendTest(w http.ResponseWriter, r *http.Request) {
	if h.dispatcher == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "alerting unavailable"})
		return
	}
	var body struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body)

	url := strings.TrimSpace(body.URL)
	if url == "" && h.mgr != nil {
		url = h.mgr.Get().AlertWebhookURL // fall back to the stored webhook
	}
	if err := h.dispatcher.SendTest(r.Context(), url); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"delivered": false, "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"delivered": true, "detail": "test alert delivered"})
}
