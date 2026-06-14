package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/billing"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// billingHandler serves usage metering and plan management at /admin/v1/billing.
type billingHandler struct {
	st    *store.Store
	meter *billing.Meter
}

// tenantUsage is a tenant plus its current-month usage, for the dashboard table.
type tenantUsage struct {
	TenantID string        `json:"tenant_id"`
	Name     string        `json:"name"`
	Tier     string        `json:"tier"`
	Active   bool          `json:"active"`
	Usage    billing.Usage `json:"usage"`
}

// listPlans returns the static plan catalog.
func (h *billingHandler) listPlans(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"plans": billing.Plans()})
}

// listUsage returns current-month usage for every tenant (or one via ?tenant=).
func (h *billingHandler) listUsage(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	if t := r.URL.Query().Get("tenant"); t != "" {
		id, err := uuid.Parse(t)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant id"})
			return
		}
		tenant, err := h.st.GetTenantByID(r.Context(), id)
		if err != nil || tenant == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant not found"})
			return
		}
		writeJSON(w, http.StatusOK, tenantUsage{
			TenantID: tenant.ID.String(), Name: tenant.Name, Tier: tenant.Tier, Active: tenant.Active,
			Usage: h.meter.Get(r.Context(), tenant.ID.String(), tenant.Tier, now),
		})
		return
	}

	tenants, err := h.st.ListTenants(r.Context())
	if err != nil {
		internalError(w, "list tenants", err)
		return
	}
	out := make([]tenantUsage, 0, len(tenants))
	for _, t := range tenants {
		out = append(out, tenantUsage{
			TenantID: t.ID.String(), Name: t.Name, Tier: t.Tier, Active: t.Active,
			Usage: h.meter.Get(r.Context(), t.ID.String(), t.Tier, now),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tenants": out, "count": len(out)})
}

// updatePlan changes a tenant's plan tier (admin only). Body: {"tier": "pro"}.
func (h *billingHandler) updatePlan(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant id"})
		return
	}
	var body struct {
		Tier string `json:"tier"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if !billing.ValidTier(body.Tier) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown plan tier"})
		return
	}
	tenant, err := h.st.UpdateTenantTier(r.Context(), id, body.Tier)
	if err != nil {
		internalError(w, "update tenant tier", err)
		return
	}
	if tenant == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant not found"})
		return
	}
	writeJSON(w, http.StatusOK, tenant)
}
