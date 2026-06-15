package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/provider"
)

// upstreamHandler implements an operator diagnostic: probe whether the gateway
// can actually reach a configured upstream LLM (a cloud provider — OpenAI/
// Anthropic/Google — or a local model such as LM Studio / Ollama). It performs a
// short GET to the provider's model-listing endpoint from inside the gateway's
// network namespace — which is the reachability that actually matters, since the
// gateway (not the browser) is what calls the model. Admin-supplied URL,
// security-role gated.
type upstreamHandler struct{}

type upstreamTestResult struct {
	Reachable  bool     `json:"reachable"`
	HTTPStatus int      `json:"http_status,omitempty"`
	Models     []string `json:"models,omitempty"`
	LatencyMs  int64    `json:"latency_ms"`
	Detail     string   `json:"detail"`
}

// modelListPaths returns the candidate model-listing paths for a provider, most
// specific first. A bare "/models" is always tried last so OpenAI-compatible
// local servers that don't prefix with /v1 still answer.
func modelListPaths(t provider.Type) []string {
	switch t {
	case provider.Anthropic:
		return []string{"/v1/models", "/models"}
	case provider.Google:
		return []string{"/v1beta/models", "/v1/models", "/models"}
	default:
		return []string{"/v1/models", "/models"}
	}
}

func (h *upstreamHandler) test(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL      string `json:"url"`
		Key      string `json:"key"`
		Provider string `json:"provider"`
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
	prov := provider.Parse(body.Provider)

	client := &http.Client{Timeout: 6 * time.Second}
	var res upstreamTestResult
	for _, path := range modelListPaths(prov) {
		start := time.Now()
		u, err := url.Parse(base + path)
		if err != nil {
			res.Detail = err.Error()
			continue
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
		if err != nil {
			res.Detail = err.Error()
			continue
		}
		// Apply provider-correct auth (Bearer / x-api-key / x-goog-api-key) exactly
		// as the live proxy would, so the probe exercises the real credential path.
		provider.ApplyAuth(req, prov, body.Key)
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
			res.Models = parseModelList(resp.Body)
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

// parseModelList extracts model IDs from a model-listing response, handling both
// the OpenAI/Anthropic shape ({"data":[{"id":…}]}) and the Gemini shape
// ({"models":[{"name":"models/…"}]}).
func parseModelList(r interface{ Read([]byte) (int, error) }) []string {
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	_ = json.NewDecoder(r).Decode(&parsed)
	var out []string
	for _, m := range parsed.Data {
		if m.ID != "" {
			out = append(out, m.ID)
		}
	}
	for _, m := range parsed.Models {
		if m.Name != "" {
			out = append(out, strings.TrimPrefix(m.Name, "models/"))
		}
	}
	return out
}
