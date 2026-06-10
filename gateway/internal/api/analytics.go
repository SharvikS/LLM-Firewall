package api

import (
	"net/http"
	"strconv"

	"github.com/sharvik/llm-firewall/gateway/internal/analytics"
)

// AnalyticsHandler serves the ClickHouse-backed OLAP endpoints consumed by
// the dashboard's analytics views. When ClickHouse is not configured every
// endpoint answers 503 so the dashboard can degrade gracefully.
type AnalyticsHandler struct {
	ch *analytics.Client
}

func NewAnalyticsHandler(ch *analytics.Client) *AnalyticsHandler {
	return &AnalyticsHandler{ch: ch}
}

// Overview handles GET /api/analytics/overview?hours=24&tenant=<uuid>
func (h *AnalyticsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	if !h.ch.Enabled() {
		writeAnalyticsDisabled(w)
		return
	}
	out, err := h.ch.Overview(r.Context(), r.URL.Query().Get("tenant"), queryHours(r))
	if err != nil {
		writeAnalyticsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// Timeseries handles GET /api/analytics/timeseries?hours=24&tenant=<uuid>
func (h *AnalyticsHandler) Timeseries(w http.ResponseWriter, r *http.Request) {
	if !h.ch.Enabled() {
		writeAnalyticsDisabled(w)
		return
	}
	points, err := h.ch.Timeseries(r.Context(), r.URL.Query().Get("tenant"), queryHours(r))
	if err != nil {
		writeAnalyticsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points, "count": len(points)})
}

// Threats handles GET /api/analytics/threats?hours=24&tenant=<uuid>
func (h *AnalyticsHandler) Threats(w http.ResponseWriter, r *http.Request) {
	if !h.ch.Enabled() {
		writeAnalyticsDisabled(w)
		return
	}
	threats, err := h.ch.TopThreats(r.Context(), r.URL.Query().Get("tenant"), queryHours(r))
	if err != nil {
		writeAnalyticsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"threats": threats, "count": len(threats)})
}

func queryHours(r *http.Request) int {
	if s := r.URL.Query().Get("hours"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			return n
		}
	}
	return 24
}

func writeAnalyticsDisabled(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{
		"error": "analytics layer not configured — set CLICKHOUSE_URL",
	})
}

func writeAnalyticsError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}
