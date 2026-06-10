package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/sharvik/llm-firewall/gateway/internal/batch"
	"github.com/sharvik/llm-firewall/gateway/internal/middleware"
)

// BatchHandler serves the asynchronous bulk-prompt API. It is mounted inside
// the API-key-authenticated group, so the tenant identity is already resolved
// on the request context by APIKeyAuth.
type BatchHandler struct{ mgr *batch.Manager }

func NewBatchHandler(mgr *batch.Manager) *BatchHandler { return &BatchHandler{mgr: mgr} }

// Submit handles POST /v1/batch.
// Body: {"requests": [ <OpenAI chat-completion request>, ... ]}
func (h *BatchHandler) Submit(w http.ResponseWriter, r *http.Request) {
	auth := middleware.GetAuthContext(r.Context())

	var body struct {
		Requests []json.RawMessage `json:"requests"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	job, err := h.mgr.Submit(r.Context(), auth.TenantID.String(), body.Requests)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// 202 Accepted — work runs asynchronously; poll the status URL.
	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id":     job.ID,
		"status":     job.Status,
		"total":      job.Total,
		"status_url": "/v1/batch/" + job.ID,
	})
}

// Status handles GET /v1/batch/{id}, scoped to the caller's tenant.
func (h *BatchHandler) Status(w http.ResponseWriter, r *http.Request) {
	auth := middleware.GetAuthContext(r.Context())
	id := chi.URLParam(r, "id")

	job, err := h.mgr.Get(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load job"})
		return
	}
	// Return 404 for both missing and cross-tenant jobs so one tenant can't
	// probe another tenant's job IDs.
	if job == nil || job.TenantID != auth.TenantID.String() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "batch job not found"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}
