package provider

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParse(t *testing.T) {
	cases := map[string]Type{
		"openai":    OpenAI,
		"OpenAI":    OpenAI,
		"groq":      OpenAI,
		"":          OpenAI,
		"custom":    OpenAI,
		"ollama":    OpenAI,
		"anthropic": Anthropic,
		"claude":    Anthropic,
		"google":    Google,
		"gemini":    Google,
	}
	for in, want := range cases {
		if got := Parse(in); got != want {
			t.Errorf("Parse(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestApplyAuthOpenAI(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://api.openai.com/v1/chat/completions", nil)
	ApplyAuth(req, OpenAI, "sk-test")
	if got := req.Header.Get("Authorization"); got != "Bearer sk-test" {
		t.Errorf("Authorization = %q, want Bearer sk-test", got)
	}
	if req.Header.Get("x-api-key") != "" || req.Header.Get("x-goog-api-key") != "" {
		t.Error("OpenAI request must not carry provider-specific keys")
	}
}

func TestApplyAuthOpenAIKeyless(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "http://localhost:11434/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer leaked-gateway-key") // must be stripped
	ApplyAuth(req, OpenAI, "")
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("keyless upstream must not receive Authorization, got %q", got)
	}
}

func TestApplyAuthAnthropic(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", nil)
	req.Header.Set("Authorization", "Bearer stale") // a stale OpenAI header must be cleared
	ApplyAuth(req, Anthropic, "sk-ant-test")
	if req.Header.Get("Authorization") != "" {
		t.Error("Anthropic request must not carry Authorization")
	}
	if got := req.Header.Get("x-api-key"); got != "sk-ant-test" {
		t.Errorf("x-api-key = %q, want sk-ant-test", got)
	}
	if got := req.Header.Get("anthropic-version"); got != DefaultAnthropicVersion {
		t.Errorf("anthropic-version = %q, want %q", got, DefaultAnthropicVersion)
	}
}

func TestApplyAuthAnthropicKeepsClientVersion(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", nil)
	req.Header.Set("anthropic-version", "2024-10-01")
	ApplyAuth(req, Anthropic, "sk-ant-test")
	if got := req.Header.Get("anthropic-version"); got != "2024-10-01" {
		t.Errorf("client-supplied anthropic-version must be preserved, got %q", got)
	}
}

func TestApplyAuthGoogleStripsQueryKey(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=client-key&alt=sse", nil)
	ApplyAuth(req, Google, "goog-secret")
	if got := req.Header.Get("x-goog-api-key"); got != "goog-secret" {
		t.Errorf("x-goog-api-key = %q, want goog-secret", got)
	}
	if req.URL.Query().Has("key") {
		t.Error("?key= must be stripped so the credential is only in the header")
	}
	if !req.URL.Query().Has("alt") {
		t.Error("unrelated query params must be preserved")
	}
	if req.Header.Get("Authorization") != "" {
		t.Error("Google request must not carry Authorization")
	}
}

func TestPromptText(t *testing.T) {
	cases := []struct {
		name string
		prov Type
		body string
		want string // substring that must appear
	}{
		{"openai string", OpenAI, `{"messages":[{"role":"user","content":"my SSN is 123"}]}`, "my SSN is 123"},
		{"openai blocks", OpenAI, `{"messages":[{"role":"user","content":[{"type":"text","text":"block text"}]}]}`, "block text"},
		{"anthropic system+msg", Anthropic, `{"system":"be terse","messages":[{"role":"user","content":"hello claude"}]}`, "hello claude"},
		{"anthropic blocks", Anthropic, `{"messages":[{"role":"user","content":[{"type":"text","text":"ant block"}]}]}`, "ant block"},
		{"gemini contents", Google, `{"contents":[{"parts":[{"text":"hello gemini"}]}]}`, "hello gemini"},
		{"gemini system", Google, `{"systemInstruction":{"parts":[{"text":"sys gemini"}]},"contents":[]}`, "sys gemini"},
	}
	for _, c := range cases {
		got := PromptText(c.prov, []byte(c.body))
		if !contains(got, c.want) {
			t.Errorf("%s: PromptText = %q, want substring %q", c.name, got, c.want)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
