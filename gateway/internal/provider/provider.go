// Package provider abstracts the wire differences between cloud LLM providers so
// the firewall can front OpenAI/ChatGPT, Anthropic Claude, and Google Gemini with
// the same security pipeline.
//
// The gateway is a transparent reverse proxy: it never rewrites a request into a
// different provider's schema. What differs per provider is (1) how the upstream
// is authenticated and (2) where the human-readable prompt text and model name
// live in the JSON — both of which this package centralises. Provider-aware text
// extraction matters for security: without it the ML analyzer would inspect the
// wrong JSON shape and PII masking would silently no-op on Claude/Gemini traffic.
package provider

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// Type identifies a supported upstream LLM provider family.
type Type string

const (
	// OpenAI covers OpenAI itself and every OpenAI-compatible upstream
	// (Groq, Together, vLLM, Ollama, LM Studio, …) — they share the
	// /v1/chat/completions schema and Bearer auth.
	OpenAI Type = "openai"
	// Anthropic is the Claude Messages API (/v1/messages, x-api-key auth).
	Anthropic Type = "anthropic"
	// Google is the Gemini generateContent API (x-goog-api-key auth).
	Google Type = "google"
)

// DefaultAnthropicVersion is sent as the anthropic-version header when the
// caller did not supply one. Anthropic requires this header on every request.
const DefaultAnthropicVersion = "2023-06-01"

// Parse normalises a free-form provider string (from settings/env) to a Type.
// Unknown, empty, "custom", "groq", local-LLM labels, etc. all resolve to
// OpenAI because they speak the OpenAI-compatible schema.
func Parse(s string) Type {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "anthropic", "claude":
		return Anthropic
	case "google", "gemini", "googleai", "vertex":
		return Google
	default:
		return OpenAI
	}
}

// FromHost infers the provider from an upstream URL or host, used to seed the
// default selection from a legacy TARGET_URL so existing deployments keep their
// behaviour. Defaults to OpenAI (covers Groq and OpenAI-compatible hosts).
func FromHost(rawURL string) Type {
	h := strings.ToLower(rawURL)
	switch {
	case strings.Contains(h, "anthropic"):
		return Anthropic
	case strings.Contains(h, "googleapis") || strings.Contains(h, "generativelanguage"):
		return Google
	default:
		return OpenAI
	}
}

// DefaultBaseURL is the canonical API base for a provider, used to prefill the
// dashboard and as a fallback when the operator leaves the upstream URL blank.
func DefaultBaseURL(t Type) string {
	switch t {
	case Anthropic:
		return "https://api.anthropic.com"
	case Google:
		return "https://generativelanguage.googleapis.com"
	default:
		return "https://api.openai.com/v1"
	}
}

// Label returns a human-readable provider name for audit attribution.
func Label(t Type) string {
	switch t {
	case Anthropic:
		return "Anthropic"
	case Google:
		return "Google"
	default:
		return "OpenAI"
	}
}

// ApplyAuth sets the credential header(s) for the provider on an outbound
// upstream request, and clears credentials it does not use so a key intended for
// one provider can never leak to another via a stale header.
//
//   - OpenAI-compatible: Authorization: Bearer <key>  (cleared when key == "",
//     e.g. a keyless local Ollama).
//   - Anthropic:        x-api-key: <key> + anthropic-version (kept if the client
//     already set a version; otherwise DefaultAnthropicVersion).
//   - Google Gemini:    x-goog-api-key: <key>, and any ?key= query param is
//     stripped from the URL so the injected header is the sole credential and the
//     gateway's key never appears in a logged URL.
func ApplyAuth(req *http.Request, t Type, key string) {
	// Start clean: drop every credential header so switching providers (or a
	// keyless upstream) never forwards a stale one.
	req.Header.Del("Authorization")
	req.Header.Del("x-api-key")
	req.Header.Del("X-Api-Key")
	req.Header.Del("x-goog-api-key")
	req.Header.Del("X-Goog-Api-Key")

	switch t {
	case Anthropic:
		if key != "" {
			req.Header.Set("x-api-key", key)
		}
		if req.Header.Get("anthropic-version") == "" {
			req.Header.Set("anthropic-version", DefaultAnthropicVersion)
		}
	case Google:
		stripQueryKey(req.URL)
		if key != "" {
			req.Header.Set("x-goog-api-key", key)
		}
	default:
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}
}

// stripQueryKey removes the ?key=... query parameter (Gemini's URL-based auth)
// so the credential is carried only in the header we control.
func stripQueryKey(u *url.URL) {
	if u == nil || u.RawQuery == "" {
		return
	}
	q := u.Query()
	if q.Has("key") {
		q.Del("key")
		u.RawQuery = q.Encode()
	}
}

// ExtractModel returns the requested model name for audit attribution, reading
// from the right place per provider:
//   - OpenAI/Anthropic: the "model" field in the JSON body.
//   - Google Gemini:    the {model} segment of /v1beta/models/{model}:method,
//     since the model is encoded in the path, not the body.
//
// Returns "unknown" when it cannot be determined.
func ExtractModel(t Type, path string, body []byte) string {
	if t == Google {
		if m := geminiModelFromPath(path); m != "" {
			return m
		}
	}
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err == nil && req.Model != "" {
		return req.Model
	}
	return "unknown"
}

// geminiModelFromPath pulls "gemini-1.5-pro" out of
// "/v1beta/models/gemini-1.5-pro:generateContent".
func geminiModelFromPath(path string) string {
	_, rest, found := strings.Cut(path, "/models/")
	if !found {
		return ""
	}
	if c := strings.IndexByte(rest, ':'); c >= 0 {
		rest = rest[:c]
	}
	if s := strings.IndexByte(rest, '/'); s >= 0 {
		rest = rest[:s]
	}
	return rest
}

// PromptText extracts the concatenated human-readable text from a request body
// for token estimation and lightweight gateway-side inspection. It mirrors the
// authoritative extraction in the Python ML engine but is used only for the
// gateway's own TPM accounting, so a best-effort result is sufficient.
//
// Falls back to the whole body string when the schema is unrecognised so a novel
// shape is never treated as empty (which would let an attacker slip under limits).
func PromptText(t Type, body []byte) string {
	if len(body) == 0 {
		return ""
	}
	switch t {
	case Google:
		if s := geminiText(body); s != "" {
			return s
		}
	case Anthropic:
		if s := anthropicText(body); s != "" {
			return s
		}
	default:
		if s := openAIText(body); s != "" {
			return s
		}
	}
	return string(body)
}

func openAIText(body []byte) string {
	var req struct {
		Messages []struct {
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return ""
	}
	var b strings.Builder
	for _, m := range req.Messages {
		writeContent(&b, m.Content)
	}
	return b.String()
}

func anthropicText(body []byte) string {
	var req struct {
		System   json.RawMessage `json:"system"`
		Messages []struct {
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return ""
	}
	var b strings.Builder
	writeContent(&b, req.System)
	for _, m := range req.Messages {
		writeContent(&b, m.Content)
	}
	return b.String()
}

func geminiText(body []byte) string {
	var req struct {
		SystemInstruction struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"systemInstruction"`
		Contents []struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"contents"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return ""
	}
	var b strings.Builder
	for _, p := range req.SystemInstruction.Parts {
		appendLine(&b, p.Text)
	}
	for _, c := range req.Contents {
		for _, p := range c.Parts {
			appendLine(&b, p.Text)
		}
	}
	return b.String()
}

// writeContent appends the text of a message "content" that may be either a JSON
// string or an array of typed blocks ({"type":"text","text":"…"}), the two
// shapes the OpenAI and Anthropic schemas allow.
func writeContent(b *strings.Builder, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		appendLine(b, s)
		return
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		for _, blk := range blocks {
			appendLine(b, blk.Text)
		}
	}
}

func appendLine(b *strings.Builder, s string) {
	if s == "" {
		return
	}
	if b.Len() > 0 {
		b.WriteByte('\n')
	}
	b.WriteString(s)
}
