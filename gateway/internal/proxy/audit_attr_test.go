package proxy

import "testing"

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

func TestParseModel(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"normal", `{"model":"llama-3.1-8b-instant","messages":[]}`, "llama-3.1-8b-instant"},
		{"gpt4o", `{"model":"gpt-4o","messages":[]}`, "gpt-4o"},
		{"missing", `{"messages":[]}`, "unknown"},
		{"empty model", `{"model":"","messages":[]}`, "unknown"},
		{"empty body", ``, "unknown"},
		{"garbage", `not json`, "unknown"},
	}
	for _, c := range cases {
		if got := parseModel([]byte(c.body)); got != c.want {
			t.Errorf("%s: parseModel(%q) = %q, want %q", c.name, c.body, got, c.want)
		}
	}
}
