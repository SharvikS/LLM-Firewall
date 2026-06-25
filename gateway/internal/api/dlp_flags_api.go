package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// atoiDefault parses a positive int query param, falling back to def.
func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return n
	}
	return def
}

// dlpFlagsHandler serves the admin portal's repeat-offender view: which subjects
// have crossed the DLP violation threshold, their violation history, and the
// ability to acknowledge a flag once handled.
type dlpFlagsHandler struct {
	st    *store.Store
	audit *auditRecorder
}

// listFlags GET /dlp/flags?status=open|acknowledged&limit=N
func (h *dlpFlagsHandler) listFlags(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	flags, err := h.st.ListDLPFlags(r.Context(), status, atoiDefault(r.URL.Query().Get("limit"), 200))
	if err != nil {
		internalError(w, "list DLP flags", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"flags": flags, "count": len(flags)})
}

// summary GET /dlp/summary — rollup counts for the portal badge + overview.
func (h *dlpFlagsHandler) summary(w http.ResponseWriter, r *http.Request) {
	sum, err := h.st.DLPSummary(r.Context())
	if err != nil {
		internalError(w, "DLP summary", err)
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

// overview GET /dlp/overview — the full browser-monitoring rollup for the
// dashboard Browser tab (totals, by-site, by-category, 24h series, recent feed,
// active installs, top offenders).
func (h *dlpFlagsHandler) overview(w http.ResponseWriter, r *http.Request) {
	ov, err := h.st.BrowserDLPOverview(r.Context())
	if err != nil {
		internalError(w, "browser DLP overview", err)
		return
	}
	writeJSON(w, http.StatusOK, ov)
}

// listViolations GET /dlp/violations?subject=...&limit=N
func (h *dlpFlagsHandler) listViolations(w http.ResponseWriter, r *http.Request) {
	subject := r.URL.Query().Get("subject")
	if subject == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "subject query param required"})
		return
	}
	v, err := h.st.ListDLPViolations(r.Context(), subject, atoiDefault(r.URL.Query().Get("limit"), 100))
	if err != nil {
		internalError(w, "list DLP violations", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"violations": v, "count": len(v), "subject": subject})
}

// ackFlag POST /dlp/flags/{id}/ack — mark a flag acknowledged by the operator.
func (h *dlpFlagsHandler) ackFlag(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid flag id"})
		return
	}
	by := identityFrom(r.Context()).Email // who acknowledged (from the session)
	if by == "" {
		by = "operator"
	}
	ok, err := h.st.AckDLPFlag(r.Context(), id, by)
	if err != nil {
		internalError(w, "ack DLP flag", err)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no open flag with that id"})
		return
	}
	h.audit.Record(r, controlAuditEvent{
		Action: "ADMIN_DLP_FLAG_ACKED", TargetType: "dlp_flag", TargetID: id.String(), Reason: "DLP flag acknowledged",
	})
	writeJSON(w, http.StatusOK, map[string]any{"acknowledged": true, "id": id, "by": by})
}
