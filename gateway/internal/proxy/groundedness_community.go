//go:build !enterprise

// Community (open-core, MIT) groundedness stub. The type and method exist so the
// proxy compiles and can call scanGroundedness unconditionally, but it never
// performs an NLI check and never flags a response. Hallucination / groundedness
// scoring is a commercial feature (groundedness.go, built with `-tags enterprise`).
package proxy

import (
	"context"

	"github.com/sharvik/llm-firewall/gateway/internal/provider"
)

// groundednessVerdict mirrors the enterprise verdict shape (fields the proxy
// reads) so call sites compile identically across editions.
type groundednessVerdict struct {
	Decision    string   `json:"decision"`
	Risk        float64  `json:"risk"`
	Checked     bool     `json:"checked"`
	Grounded    bool     `json:"grounded"`
	Reason      string   `json:"reason"`
	Unsupported []string `json:"unsupported"`
}

// scanGroundedness is a no-op in the community build: it always returns a clean,
// non-flagged verdict so a real answer is never withheld.
func (p *LLMProxy) scanGroundedness(_ context.Context, _ provider.Type, _, _ []byte) (groundednessVerdict, bool) {
	return groundednessVerdict{Decision: "allow", Grounded: true}, false
}
