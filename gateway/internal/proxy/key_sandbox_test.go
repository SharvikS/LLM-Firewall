package proxy

import (
	"testing"

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
