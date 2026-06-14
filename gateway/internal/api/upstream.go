package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// upstreamHandler implements an operator diagnostic: probe whether the gateway
// can actually reach a configured upstream LLM (an API provider or a local model
// such as LM Studio / Ollama). It performs a short GET to the upstream's
// /v1/models endpoint from inside the gateway's network namespace — which is the
// reachability that actually matters, since the gateway (not the browser) is what
// calls the model. Admin-supplied URL, security-role gated.
type upstreamHandler struct{}

type upstreamTestResult struct {
	Reachable  bool     `json:"reachable"`
	HTTPStatus int      `json:"http_status,omitempty"`
	Models     []string `json:"models,omitempty"`
	LatencyMs  int64    `json:"latency_ms"`
	Detail     string   `json:"detail"`
}

func (h *upstreamHandler) test(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
		Key string `json:"key"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	base := strings.TrimRight(strings.TrimSpace(body.URL), "/")
	if base == "" || (!strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://")) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url must start with http:// or https://"})
		return
	}

	// Try the standard model-listing path, then a bare /models fallback.
	client := &http.Client{Timeout: 6 * time.Second}
	var res upstreamTestResult
	for _, path := range []string{"/v1/models", "/models"} {
		start := time.Now()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, base+path, nil)
		if err != nil {
			res.Detail = err.Error()
			continue
		}
		if body.Key != "" {
			req.Header.Set("Authorization", "Bearer "+body.Key)
		}
		resp, err := client.Do(req)
		res.LatencyMs = time.Since(start).Milliseconds()
		if err != nil {
			res.Detail = err.Error()
			continue
		}
		res.HTTPStatus = resp.StatusCode
		// Any HTTP response means the host is reachable; 2xx means the API answered.
		res.Reachable = true
		if resp.StatusCode == http.StatusOK {
			var parsed struct {
				Data []struct {
					ID string `json:"id"`
				} `json:"data"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&parsed)
			for _, m := range parsed.Data {
				if m.ID != "" {
					res.Models = append(res.Models, m.ID)
				}
			}
			resp.Body.Close()
			res.Detail = "reachable; API responded"
			writeJSON(w, http.StatusOK, res)
			return
		}
		resp.Body.Close()
		res.Detail = "reachable, but the API returned a non-200 (check the key / path)"
		writeJSON(w, http.StatusOK, res)
		return
	}

	if res.Detail == "" {
		res.Detail = "unreachable"
	}
	writeJSON(w, http.StatusOK, res)
}
