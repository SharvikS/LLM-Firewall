package api

import (
	"encoding/json"
	"net/http"
	"os"
)

// securityHandler serves the consolidated CVE-scan report (written by
// scripts/security-scan.sh or the security-scan CI workflow) to the dashboard
// Vulnerabilities tab. It only reads a file — scanning itself never runs in the
// gateway process.
type securityHandler struct {
	reportPath string
}

func (h *securityHandler) scanReport(w http.ResponseWriter, _ *http.Request) {
	raw, err := os.ReadFile(h.reportPath)
	if err != nil {
		// No report yet — tell the dashboard so it can prompt to run a scan,
		// rather than erroring.
		writeJSON(w, http.StatusOK, map[string]any{
			"available": false,
			"hint":      "run scripts/security-scan.sh or the security-scan CI workflow",
		})
		return
	}
	var report any
	if err := json.Unmarshal(raw, &report); err != nil {
		internalError(w, "parse scan report", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": true, "report": report})
}
