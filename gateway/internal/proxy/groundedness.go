//go:build enterprise

// TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.
//
// Response-side groundedness / hallucination scoring. This is a commercial
// feature; the community build links a no-op scanGroundedness
// (groundedness_community.go) that never flags.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/provider"
)

// groundednessVerdict mirrors the ML engine's /scan-groundedness response. The
// engine scores how well an assistant response is supported by the request's
// context (system instructions / RAG docs / user-supplied source text).
type groundednessVerdict struct {
	Decision    string   `json:"decision"` // allow | flag | block
	Risk        float64  `json:"risk"`     // 0-100, fraction of unsupported sentences
	Checked     bool     `json:"checked"`  // did a real NLI check run?
	Grounded    bool     `json:"grounded"`
	Reason      string   `json:"reason"`
	Unsupported []string `json:"unsupported"`
}

// groundednessClient is a small dedicated HTTP client for the engine's
// side-channel; the per-call deadline is enforced via the request context.
var groundednessClient = &http.Client{}

// collectResponseText concatenates every assistant message in a provider's
// response body into a single string for scoring — reusing the same
// provider-aware walkers the output masker uses, in read-only mode.
func collectResponseText(prov provider.Type, body []byte) string {
	var sb strings.Builder
	rewriteAssistantContent(prov, body, func(text string) (string, bool) {
		sb.WriteString(text)
		sb.WriteByte('\n')
		return text, false // never rewrite — we only want to read the text
	})
	return strings.TrimSpace(sb.String())
}

// scanGroundedness scores the response against the request context via the ML
// engine. Returns the verdict and whether it should be surfaced as a finding
// (decision "flag" or "block"). Fail-open: a disabled gate, missing context,
// empty response, or any transport/parse error returns a clean, non-flagged
// verdict so a real answer is never withheld on the gate's own failure.
func (p *LLMProxy) scanGroundedness(ctx context.Context, prov provider.Type, reqBody, respBody []byte) (groundednessVerdict, bool) {
	clean := groundednessVerdict{Decision: "allow", Grounded: true}
	if !p.cfg.GroundednessEnabled || p.cfg.GroundednessEngineURL == "" {
		return clean, false
	}

	contextText := provider.PromptText(prov, reqBody) // the grounding source
	responseText := collectResponseText(prov, respBody)
	if strings.TrimSpace(contextText) == "" || responseText == "" {
		return clean, false
	}

	payload, err := json.Marshal(map[string]string{"context": contextText, "response": responseText})
	if err != nil {
		return clean, false
	}

	timeout := time.Duration(p.cfg.GroundednessTimeoutMs) * time.Millisecond
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url := strings.TrimRight(p.cfg.GroundednessEngineURL, "/") + "/scan-groundedness"
	req, err := http.NewRequestWithContext(rctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return clean, false
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := groundednessClient.Do(req)
	if err != nil {
		return clean, false // fail-open: engine unreachable/timed out
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return clean, false
	}

	var v groundednessVerdict
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		return clean, false
	}
	flagged := v.Decision == "flag" || v.Decision == "block"
	return v, flagged
}
