//go:build !enterprise

// Community (open-core, MIT) compliance stub. The routes stay registered so the
// Admin API surface is stable, but compliance reporting and audit export are a
// commercial feature (compliance.go, built with `-tags enterprise`) and return
// a 402 upsell here.
package api

import "net/http"

func (h *adminHandler) complianceReport(w http.ResponseWriter, r *http.Request) {
	complianceUpsell(w)
}

func (h *adminHandler) complianceExport(w http.ResponseWriter, r *http.Request) {
	complianceUpsell(w)
}

func complianceUpsell(w http.ResponseWriter) {
	writeJSON(w, http.StatusPaymentRequired, map[string]string{
		"error":   "compliance reporting & audit export is a TITAN Enterprise feature",
		"upgrade": "https://titan.sharvik.tech/pricing",
	})
}
