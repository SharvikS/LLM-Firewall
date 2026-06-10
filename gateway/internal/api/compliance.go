package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// ── Compliance reporting (SOC2 / GDPR / HIPAA evidence) ──────────────────────
//
// GET /admin/v1/compliance/report?from=&to=&tenant=
//	JSON summary of the audit trail for the period: totals, action and
//	region breakdowns, risk stats — the evidence block auditors ask for.
//
// GET /admin/v1/compliance/export?format=csv|jsonl&from=&to=&tenant=
//	Streams the full audit trail for the period. CSV for spreadsheet
//	review, JSON Lines for SIEM ingestion. Pages internally via the
//	keyset cursor so exports of any size run in bounded memory.

func (h *adminHandler) complianceReport(w http.ResponseWriter, r *http.Request) {
	from, to, tenantID, err := complianceParams(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	summary, err := h.st.GetComplianceSummary(r.Context(), tenantID, from, to)
	if err != nil {
		internalError(w, "compliance report", err)
		return
	}

	blocked := int64(0)
	for action, n := range summary.ActionBreakdown {
		if action != "ALLOWED" {
			blocked += n
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"report_type":  "audit-trail-summary",
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"summary":      summary,
		"governance": map[string]any{
			"total_governed_requests": summary.TotalEvents,
			"blocked_requests":        blocked,
			"enforcement_active":      summary.TotalEvents > 0,
		},
		"attestations": map[string]string{
			"audit_trail":    "All proxied LLM requests are governed and recorded with action, risk score, latency and region.",
			"data_retention": "Relational audit rows are retained indefinitely; the OLAP copy (ClickHouse) carries a 90-day TTL.",
			"pii_handling":   "Prompts are PII-masked (Microsoft Presidio) and secret-scanned before leaving the trust boundary; raw prompts are not persisted in the audit trail.",
		},
	})
}

var auditCSVHeader = []string{
	"id", "created_at", "request_id", "tenant_id", "api_key_id",
	"action", "risk_score", "path", "latency_ms", "status_code", "reason", "region",
}

func (h *adminHandler) complianceExport(w http.ResponseWriter, r *http.Request) {
	from, to, tenantID, err := complianceParams(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "csv"
	}
	stamp := time.Now().UTC().Format("20060102T150405Z")

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="titan-audit-export-%s.csv"`, stamp))
		cw := csv.NewWriter(w)
		if err := cw.Write(auditCSVHeader); err != nil {
			return
		}
		streamErr := h.st.StreamAuditRange(r.Context(), tenantID, from, to, func(e store.AuditEventRow) error {
			return cw.Write(auditRowToCSV(e))
		})
		cw.Flush()
		if streamErr != nil {
			internalError(w, "compliance export (csv)", streamErr)
		}

	case "jsonl":
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="titan-audit-export-%s.jsonl"`, stamp))
		enc := json.NewEncoder(w)
		streamErr := h.st.StreamAuditRange(r.Context(), tenantID, from, to, func(e store.AuditEventRow) error {
			return enc.Encode(e)
		})
		if streamErr != nil {
			internalError(w, "compliance export (jsonl)", streamErr)
		}

	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "format must be csv or jsonl"})
	}
}

// auditRowToCSV flattens an audit row into the CSV column order, mapping
// nil pointers to empty cells.
func auditRowToCSV(e store.AuditEventRow) []string {
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	row := []string{
		e.ID.String(),
		e.CreatedAt.UTC().Format(time.RFC3339Nano),
		e.RequestID,
		"", // tenant_id
		"", // api_key_id
		e.Action,
		"", // risk_score
		str(e.Path),
		"", // latency_ms
		"", // status_code
		str(e.Reason),
		e.Region,
	}
	if e.TenantID != nil {
		row[3] = e.TenantID.String()
	}
	if e.APIKeyID != nil {
		row[4] = e.APIKeyID.String()
	}
	if e.RiskScore != nil {
		row[6] = strconv.FormatFloat(*e.RiskScore, 'f', 2, 64)
	}
	if e.LatencyMs != nil {
		row[8] = strconv.FormatInt(*e.LatencyMs, 10)
	}
	if e.StatusCode != nil {
		row[9] = strconv.Itoa(*e.StatusCode)
	}
	return row
}

// complianceParams parses from/to (RFC3339 or YYYY-MM-DD) and the optional
// tenant filter. Defaults: trailing 30 days, all tenants.
func complianceParams(r *http.Request) (from, to time.Time, tenantID *uuid.UUID, err error) {
	to = time.Now().UTC()
	from = to.AddDate(0, 0, -30)

	if s := r.URL.Query().Get("from"); s != "" {
		from, err = parseFlexTime(s)
		if err != nil {
			return from, to, nil, fmt.Errorf("invalid from: %s", s)
		}
	}
	if s := r.URL.Query().Get("to"); s != "" {
		to, err = parseFlexTime(s)
		if err != nil {
			return from, to, nil, fmt.Errorf("invalid to: %s", s)
		}
	}
	if !from.Before(to) {
		return from, to, nil, fmt.Errorf("from must be before to")
	}
	if s := r.URL.Query().Get("tenant"); s != "" {
		id, perr := uuid.Parse(s)
		if perr != nil {
			return from, to, nil, fmt.Errorf("invalid tenant: %s", s)
		}
		tenantID = &id
	}
	return from, to, tenantID, nil
}

func parseFlexTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02", s)
}
