package proxy

import (
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/provider"
)

func TestProviderFromHost(t *testing.T) {
	cases := map[string]string{
		"api.groq.com":                      "Groq",
		"api.openai.com":                    "OpenAI",
		"api.anthropic.com":                 "Anthropic",
		"generativelanguage.googleapis.com": "Google",
		"":                                  "unknown",
		"llm.internal.acme.dev":             "llm.internal.acme.dev",
	}
	for host, want := range cases {
		if got := providerFromHost(host); got != want {
			t.Errorf("providerFromHost(%q) = %q, want %q", host, got, want)
		}
	}
}

func TestExtractModel(t *testing.T) {
	cases := []struct {
		name string
		prov provider.Type
		path string
		body string
		want string
	}{
		{"openai normal", provider.OpenAI, "/v1/chat/completions", `{"model":"llama-3.1-8b-instant","messages":[]}`, "llama-3.1-8b-instant"},
		{"openai gpt4o", provider.OpenAI, "/v1/chat/completions", `{"model":"gpt-4o","messages":[]}`, "gpt-4o"},
		{"anthropic body", provider.Anthropic, "/v1/messages", `{"model":"claude-opus-4-8","messages":[]}`, "claude-opus-4-8"},
		{"gemini from path", provider.Google, "/v1beta/models/gemini-1.5-pro:generateContent", `{"contents":[]}`, "gemini-1.5-pro"},
		{"gemini stream path", provider.Google, "/v1beta/models/gemini-2.0-flash:streamGenerateContent", `{}`, "gemini-2.0-flash"},
		{"missing", provider.OpenAI, "/v1/chat/completions", `{"messages":[]}`, "unknown"},
		{"empty model", provider.OpenAI, "/v1/chat/completions", `{"model":"","messages":[]}`, "unknown"},
		{"empty body", provider.OpenAI, "/v1/chat/completions", ``, "unknown"},
		{"garbage", provider.OpenAI, "/v1/chat/completions", `not json`, "unknown"},
	}
	for _, c := range cases {
		if got := provider.ExtractModel(c.prov, c.path, []byte(c.body)); got != c.want {
			t.Errorf("%s: ExtractModel(%v, %q, %q) = %q, want %q", c.name, c.prov, c.path, c.body, got, c.want)
		}
	}
}
