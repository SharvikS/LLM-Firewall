package proxy

import (
	"net/url"
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/provider"
	"github.com/sharvik/llm-firewall/gateway/internal/settings"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

func TestMatchesAnySupportsSimpleWildcards(t *testing.T) {
	for _, tc := range []struct {
		name     string
		value    string
		patterns []string
		want     bool
	}{
		{"exact", "gpt-4o-mini", []string{"gpt-4o-mini"}, true},
		{"prefix wildcard", "llama-3.1-8b-instant", []string{"llama-3*"}, true},
		{"suffix wildcard", "/v1/chat/completions", []string{"*/completions"}, true},
		{"middle wildcard", "claude-sonnet-4", []string{"claude*4"}, true},
		{"miss", "gpt-4o", []string{"llama-*", "claude-*"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchesAny(tc.value, tc.patterns); got != tc.want {
				t.Fatalf("matchesAny(%q, %#v) = %v, want %v", tc.value, tc.patterns, got, tc.want)
			}
		})
	}
}

func TestCheckKeySandboxBlocksDisallowedModel(t *testing.T) {
	p := &LLMProxy{}
	denied, reason := p.checkKeySandbox(store.APISandbox{
		Enabled:       true,
		AllowedModels: []string{"llama-3*"},
		AllowedPaths:  []string{"/v1/chat/completions"},
	}, "/v1/chat/completions", "gpt-4o", settings.Settings{PIIRedactionEnabled: true, OutputScanEnabled: true})
	if !denied {
		t.Fatal("expected sandbox denial")
	}
	if reason == "" {
		t.Fatal("expected denial reason")
	}
}

func TestCheckKeySandboxRequiresControls(t *testing.T) {
	p := &LLMProxy{}
	denied, reason := p.checkKeySandbox(store.APISandbox{
		Enabled:             true,
		AllowedPaths:        []string{"/v1/chat/completions"},
		RequireOutputScan:   true,
		RequirePIIRedaction: true,
	}, "/v1/chat/completions", "llama-3.1-8b", settings.Settings{PIIRedactionEnabled: true})
	if !denied || reason != "API key sandbox requires output response scanning to be enabled" {
		t.Fatalf("denied=%v reason=%q", denied, reason)
	}
}

func TestApplySandboxUpstreamFallsBackWhenNoOverride(t *testing.T) {
	gatewayUp, _ := url.Parse("https://api.groq.com")
	up, key, prov := applySandboxUpstream(gatewayUp, "gateway-key", provider.OpenAI, store.APISandbox{})
	if up != gatewayUp || key != "gateway-key" || prov != provider.OpenAI {
		t.Fatalf("got up=%v key=%q prov=%q, want the gateway defaults unchanged", up, key, prov)
	}
}

func TestApplySandboxUpstreamOverridesToDifferentDialect(t *testing.T) {
	gatewayUp, _ := url.Parse("https://api.groq.com")
	sandbox := store.APISandbox{
		UpstreamProvider: "anthropic",
		UpstreamURL:      "https://api.anthropic.com",
		UpstreamAPIKey:   "sk-ant-key",
	}
	up, key, prov := applySandboxUpstream(gatewayUp, "gateway-key", provider.OpenAI, sandbox)
	if up.Host != "api.anthropic.com" {
		t.Fatalf("up.Host = %q, want api.anthropic.com", up.Host)
	}
	if key != "sk-ant-key" {
		t.Fatalf("key = %q, want the sandbox's own key", key)
	}
	if prov != provider.Anthropic {
		t.Fatalf("prov = %q, want anthropic", prov)
	}
}

func TestApplySandboxUpstreamIgnoresUnparsableOverride(t *testing.T) {
	gatewayUp, _ := url.Parse("https://api.groq.com")
	sandbox := store.APISandbox{UpstreamURL: "://not a url"}
	up, key, prov := applySandboxUpstream(gatewayUp, "gateway-key", provider.OpenAI, sandbox)
	if up != gatewayUp || key != "gateway-key" || prov != provider.OpenAI {
		t.Fatalf("got up=%v key=%q prov=%q, want the gateway defaults on an unusable override", up, key, prov)
	}
}

// TestApplySandboxUpstreamConcurrentKeysRouteIndependently is the point of
// this feature: many requests carrying different keys' sandboxes must
// resolve to their own upstream independently and concurrently, with no
// shared mutable state between them (applySandboxUpstream is pure).
func TestApplySandboxUpstreamConcurrentKeysRouteIndependently(t *testing.T) {
	gatewayUp, _ := url.Parse("https://api.groq.com")
	sandboxes := []store.APISandbox{
		{UpstreamProvider: "openai", UpstreamURL: "https://api.openai.com", UpstreamAPIKey: "openai-key"},
		{UpstreamProvider: "anthropic", UpstreamURL: "https://api.anthropic.com", UpstreamAPIKey: "anthropic-key"},
		{UpstreamProvider: "google", UpstreamURL: "https://generativelanguage.googleapis.com", UpstreamAPIKey: "google-key"},
		{}, // no override — stays on the gateway default
	}
	wantHosts := []string{"api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.groq.com"}

	const iterationsPerKey = 200
	done := make(chan struct{}, len(sandboxes)*iterationsPerKey)
	for i, sandbox := range sandboxes {
		i, sandbox := i, sandbox
		for n := 0; n < iterationsPerKey; n++ {
			go func() {
				defer func() { done <- struct{}{} }()
				up, _, _ := applySandboxUpstream(gatewayUp, "gateway-key", provider.OpenAI, sandbox)
				if up.Host != wantHosts[i] {
					t.Errorf("sandbox %d: up.Host = %q, want %q", i, up.Host, wantHosts[i])
				}
			}()
		}
	}
	for i := 0; i < len(sandboxes)*iterationsPerKey; i++ {
		<-done
	}
}
