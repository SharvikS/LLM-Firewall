package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	sandboxrt "github.com/sharvik/llm-firewall/gateway/internal/sandbox"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

type sandboxHandler struct {
	mgr *sandboxrt.Manager
	st  *store.Store
}

func (h *sandboxHandler) list(w http.ResponseWriter, _ *http.Request) {
	if h == nil || h.mgr == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"configured": false,
			"executions": []sandboxrt.Execution{},
			"count":      0,
		})
		return
	}
	executions := h.mgr.List()
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": h.mgr.Configured(),
		"executions": executions,
		"count":      len(executions),
	})
}

func (h *sandboxHandler) execute(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sandbox manager unavailable"})
		return
	}
	var body sandboxrt.ExecuteRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	exec, err := h.mgr.Execute(r.Context(), body, h.auditCompletion(r))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"configured": h.mgr.Configured(),
		"execution":  exec,
	})
}

func (h *sandboxHandler) cancel(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.mgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sandbox manager unavailable"})
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sandbox id required"})
		return
	}
	exec, ok := h.mgr.Cancel(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sandbox execution not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "cancelling",
		"execution": exec,
	})
}

func (h *sandboxHandler) auditCompletion(r *http.Request) sandboxrt.CompletionFunc {
	if h == nil || h.st == nil || r == nil {
		return nil
	}
	id := identityFrom(r.Context())
	actorType := "anonymous"
	if id.Machine {
		actorType = "machine"
	} else if id.Email != "" {
		actorType = "human"
	}
	actorRole := ""
	if id.Role != "" {
		actorRole = string(id.Role)
	}
	template := store.AuditRow{
		RequestID:  requestID(r),
		Path:       r.URL.Path,
		Region:     "control-plane",
		ActorID:    id.UserID,
		ActorEmail: id.Email,
		ActorRole:  actorRole,
		ActorType:  actorType,
		TargetType: "sandbox",
		SourceIP:   clientIP(r),
		UserAgent:  r.UserAgent(),
	}
	return func(exec sandboxrt.Execution) {
		row := template
		row.EventID = uuid.NewString()
		row.Action = sandboxAuditAction(exec.Status)
		row.StatusCode = sandboxStatusCode(exec.Status)
		row.RiskScore = sandboxRisk(exec.RiskScores)
		row.LatencyMs = exec.ElapsedMs
		row.Reason = exec.Reason
		if row.Reason == "" {
			row.Reason = exec.Error
		}
		row.TargetID = exec.ID

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := h.st.InsertAuditBatch(ctx, []store.AuditRow{row}); err != nil {
			logger.Get().Warn("sandbox audit insert failed",
				slog.String("execution_id", exec.ID),
				slog.String("status", exec.Status),
				slog.String("error", err.Error()),
			)
		}
	}
}

func sandboxAuditAction(status string) string {
	switch status {
	case "allowed":
		return "ASR_SANDBOX_ALLOWED"
	case "blocked":
		return "ASR_SANDBOX_BLOCKED"
	case "approval_required":
		return "ASR_SANDBOX_APPROVAL_REQUIRED"
	case "cancelled":
		return "ASR_SANDBOX_CANCELLED"
	case "error":
		return "ASR_SANDBOX_ERROR"
	default:
		return "ASR_SANDBOX_COMPLETED"
	}
}

func sandboxStatusCode(status string) int {
	switch status {
	case "allowed":
		return http.StatusOK
	case "blocked", "approval_required":
		return http.StatusForbidden
	case "cancelled":
		return http.StatusRequestTimeout
	default:
		return http.StatusBadGateway
	}
}

func sandboxRisk(scores map[string]float64) float64 {
	if len(scores) == 0 {
		return 0
	}
	if score, ok := scores["overall_risk"]; ok {
		return score
	}
	var max float64
	for _, score := range scores {
		if score > max {
			max = score
		}
	}
	return max
}
