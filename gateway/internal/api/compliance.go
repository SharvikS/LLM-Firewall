//go:build enterprise

// TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.
//
// Compliance reporting and audit export. This is a commercial feature; the
// community build registers the same routes but returns a 402 upsell
// (compliance_community.go).
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
	if tenantID, err = h.applyComplianceScope(w, r, tenantID); err != nil {
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

func (h *adminHandler) complianceCoverage(w http.ResponseWriter, r *http.Request) {
	from, to, tenantID, err := complianceParams(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if tenantID, err = h.applyComplianceScope(w, r, tenantID); err != nil {
		return
	}
	summary, err := h.st.GetComplianceSummary(r.Context(), tenantID, from, to)
	if err != nil {
		internalError(w, "compliance coverage", err)
		return
	}
	actionCount := func(names ...string) int64 {
		var total int64
		for _, name := range names {
			total += summary.ActionBreakdown[name]
		}
		return total
	}
	controls := []map[string]any{
		{"framework": "OWASP LLM Top 10", "control": "LLM01 Prompt Injection", "status": "covered", "evidence": actionCount("ML_BLOCKED", "GUARDRAIL_BLOCKED"), "implementation": "ML injection detector, no-code guardrails, Cedar default-deny"},
		{"framework": "OWASP LLM Top 10", "control": "LLM02 Sensitive Information Disclosure", "status": "covered", "evidence": actionCount("MASKED", "OUTPUT_MASKED", "BROWSER_REDACT"), "implementation": "Presidio PII masking, secret scanner, output scanning, browser DLP"},
		{"framework": "OWASP LLM Top 10", "control": "LLM04 Data and Model Poisoning", "status": "partial", "evidence": actionCount("CEDAR_BLOCKED"), "implementation": "Policy allowlists and tenant-scoped controls; training-data governance remains external"},
		{"framework": "OWASP LLM Top 10", "control": "LLM05 Improper Output Handling", "status": "covered", "evidence": actionCount("OUTPUT_MASKED", "HALLUCINATION_FLAGGED"), "implementation": "Response-side output masking and groundedness gate"},
		{"framework": "OWASP LLM Top 10", "control": "LLM06 Excessive Agency", "status": "partial", "evidence": actionCount("ASR_BLOCKED"), "implementation": "Agent Security Runtime and sandboxing path for tool execution"},
		{"framework": "OWASP LLM Top 10", "control": "LLM07 System Prompt Leakage", "status": "covered", "evidence": actionCount("SECRET_MASKED", "GUARDRAIL_BLOCKED"), "implementation": "Secret scanner, source-code leak controls, guardrails"},
		{"framework": "OWASP LLM Top 10", "control": "LLM10 Unbounded Consumption", "status": "covered", "evidence": actionCount("RATE_LIMITED", "QUOTA_EXCEEDED"), "implementation": "RPM/TPM rate limits and enterprise monthly quotas"},
		{"framework": "NIST AI RMF / GenAI Profile", "control": "Govern", "status": "covered", "evidence": actionCount("ADMIN_POLICY_CREATED", "ADMIN_POLICY_UPDATED"), "implementation": "RBAC, SSO, policy version history, control-plane audit"},
		{"framework": "NIST AI RMF / GenAI Profile", "control": "Map", "status": "covered", "evidence": summary.UniqueTenants, "implementation": "Tenant/app inventory through keys, policies, audit, billing, and dashboard"},
		{"framework": "NIST AI RMF / GenAI Profile", "control": "Measure", "status": "covered", "evidence": summary.TotalEvents, "implementation": "Audit trail, risk scores, analytics, eval harness"},
		{"framework": "NIST AI RMF / GenAI Profile", "control": "Manage", "status": "covered", "evidence": actionCount("ML_BLOCKED", "CEDAR_BLOCKED", "BROWSER_BLOCK"), "implementation": "Runtime enforcement, SIEM exports, DLP flags, admin acknowledgement"},
	}
	covered := 0
	for _, c := range controls {
		if c["status"] == "covered" {
			covered++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"report_type":  "ai-security-control-coverage",
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"period":       map[string]time.Time{"from": from, "to": to},
		"summary": map[string]any{
			"controls": len(controls),
			"covered":  covered,
			"partial":  len(controls) - covered,
			"events":   summary.TotalEvents,
		},
		"controls": controls,
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
	if tenantID, err = h.applyComplianceScope(w, r, tenantID); err != nil {
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

func (h *adminHandler) applyComplianceScope(w http.ResponseWriter, r *http.Request, tenantID *uuid.UUID) (*uuid.UUID, error) {
	id := identityFrom(r.Context())
	if tenantID != nil {
		if !canAccessTenant(id, *tenantID) {
			forbiddenTenant(w)
			return nil, fmt.Errorf("forbidden")
		}
		return tenantID, nil
	}
	if id.Global {
		return nil, nil
	}
	if tid, ok := singleScopedTenant(id); ok {
		return &tid, nil
	}
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant id required for scoped user"})
	return nil, fmt.Errorf("tenant required")
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
