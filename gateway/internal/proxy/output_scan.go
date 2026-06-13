package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
)

// bufferingResponse captures the upstream response (status, headers, body)
// WITHOUT writing to the client, so the body can be scanned and rewritten
// before it is sent. To stay memory-safe it buffers only up to
// maxCacheBodyBytes; on overflow it flushes what it has and streams the rest
// straight through (no scanning possible for oversized responses).
type bufferingResponse struct {
	w           http.ResponseWriter
	body        bytes.Buffer
	statusCode  int
	wroteHeader bool
	overflowed  bool
}

func newBufferingResponse(w http.ResponseWriter) *bufferingResponse {
	return &bufferingResponse{w: w, statusCode: http.StatusOK}
}

func (b *bufferingResponse) Header() http.Header { return b.w.Header() }

func (b *bufferingResponse) WriteHeader(code int) {
	// Capture only — real headers/status are written at finalize time (or on
	// overflow) so a rewritten body can carry a corrected Content-Length.
	b.statusCode = code
}

func (b *bufferingResponse) Write(p []byte) (int, error) {
	if b.overflowed {
		return b.w.Write(p)
	}
	if b.body.Len()+len(p) > maxCacheBodyBytes {
		// Too large to hold/scan — commit headers, flush buffered prefix, then
		// stream this and all subsequent chunks directly.
		b.overflowed = true
		b.commitHeader()
		if b.body.Len() > 0 {
			b.w.Write(b.body.Bytes()) //nolint:errcheck
			b.body = bytes.Buffer{}
		}
		return b.w.Write(p)
	}
	return b.body.Write(p)
}

func (b *bufferingResponse) Flush() {
	if f, ok := b.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (b *bufferingResponse) commitHeader() {
	if b.wroteHeader {
		return
	}
	b.wroteHeader = true
	b.w.WriteHeader(b.statusCode)
}

// finalize writes the captured (possibly rewritten) body to the client. It is a
// no-op when the response already overflowed (already streamed). When body is
// non-nil it replaces the captured buffer and Content-Length is corrected.
func (b *bufferingResponse) finalize(body []byte) {
	if b.overflowed {
		return
	}
	if body == nil {
		body = b.body.Bytes()
	} else {
		b.w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	}
	b.commitHeader()
	b.w.Write(body) //nolint:errcheck
}

// scanResponseBody runs each assistant message in an OpenAI-format chat
// completion response through the ML engine and substitutes any PII/secret
// masking the engine applies. Returns the (possibly) rewritten body and whether
// anything was masked. Fail-open: on any parse/RPC error the original body is
// returned unchanged.
func (p *LLMProxy) scanResponseBody(ctx context.Context, reqID, tenant string, body []byte) ([]byte, bool) {
	return rewriteAssistantContent(body, func(text string) (string, bool) {
		return p.maskText(ctx, reqID, tenant, text)
	})
}

// rewriteAssistantContent applies mask() to every choices[].message.content in
// an OpenAI-format response and returns the rewritten body. Unknown provider
// fields are preserved (it rewrites a generic map, not a typed struct).
// Fail-open: any parse/marshal error returns the original body unchanged.
func rewriteAssistantContent(body []byte, mask func(string) (string, bool)) ([]byte, bool) {
	var generic map[string]any
	if err := json.Unmarshal(body, &generic); err != nil {
		return body, false
	}
	choices, ok := generic["choices"].([]any)
	if !ok || len(choices) == 0 {
		return body, false
	}

	masked := false
	for _, c := range choices {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		msg, ok := cm["message"].(map[string]any)
		if !ok {
			continue
		}
		text, ok := msg["content"].(string)
		if !ok || text == "" {
			continue
		}
		if maskedText, did := mask(text); did {
			msg["content"] = maskedText
			masked = true
		}
	}

	if !masked {
		return body, false
	}
	// Encode with HTML escaping off so mask tokens like <EMAIL_ADDRESS> stay
	// literal rather than becoming <EMAIL_ADDRESS> in the response.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(generic); err != nil {
		return body, false // fail-open: never corrupt the response
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), true
}

// maskText sends a single piece of text through the ML engine (wrapped as a
// chat message) and returns the masked version when PII/secrets were found.
func (p *LLMProxy) maskText(ctx context.Context, reqID, tenant, text string) (string, bool) {
	synthetic, err := json.Marshal(map[string]any{
		"messages": []map[string]string{{"role": "assistant", "content": text}},
	})
	if err != nil {
		return text, false
	}
	timeout := time.Duration(p.cfg.OutputScanTimeoutMs) * time.Millisecond
	res := p.mlClient.AnalyzeWithTimeout(ctx, reqID, tenant, string(synthetic), timeout)
	if res.Action != analyzer.ActionMask || res.MaskedPrompt == "" {
		return text, false
	}
	var maskedBody struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal([]byte(res.MaskedPrompt), &maskedBody); err != nil || len(maskedBody.Messages) == 0 {
		return text, false
	}
	out := maskedBody.Messages[0].Content
	if out == "" || out == text {
		return text, false
	}
	return out, true
}
