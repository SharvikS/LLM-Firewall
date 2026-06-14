package proxy

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// sseEvent builds one OpenAI-style streaming chunk for the given content.
func sseEvent(content string) string {
	ev := map[string]any{
		"id":      "chatcmpl-x",
		"object":  "chat.completion.chunk",
		"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": content}}},
	}
	b, _ := json.Marshal(ev)
	return "data: " + string(b) + "\n\n"
}

// collectContent reconstructs the assistant text from a masked SSE stream.
func collectContent(t *testing.T, raw string) string {
	t.Helper()
	var sb strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		payload, ok := strings.CutPrefix(line, "data: ")
		if !ok || strings.TrimSpace(payload) == "[DONE]" {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			continue
		}
		c, has, _ := extractDelta(ev)
		if has {
			sb.WriteString(c)
		}
	}
	return sb.String()
}

// run feeds the given writes through a streamMasker and returns the output.
func run(t *testing.T, writes []string) (string, bool) {
	t.Helper()
	rec := httptest.NewRecorder()
	sm := newStreamMasker(rec)
	for _, w := range writes {
		if _, err := sm.Write([]byte(w)); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	if err := sm.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return rec.Body.String(), sm.masked
}

func TestStreamMasksEmailInSingleDelta(t *testing.T) {
	in := sseEvent("Contact me at john.doe@example.com please.") + "data: [DONE]\n\n"
	out, masked := run(t, []string{in})
	if !masked {
		t.Fatal("expected masking")
	}
	got := collectContent(t, out)
	if strings.Contains(got, "john.doe@example.com") {
		t.Fatalf("email leaked: %q", got)
	}
	if !strings.Contains(got, "<EMAIL_ADDRESS>") {
		t.Fatalf("no mask token: %q", got)
	}
}

func TestStreamMasksSSNSplitAcrossDeltas(t *testing.T) {
	// An SSN split one digit per delta — the classic cross-chunk leak.
	parts := []string{"My SSN is ", "123", "-", "45", "-", "6789", " ok"}
	var writes []string
	for _, p := range parts {
		writes = append(writes, sseEvent(p))
	}
	writes = append(writes, "data: [DONE]\n\n")
	out, masked := run(t, writes)
	if !masked {
		t.Fatal("expected SSN to be masked across chunks")
	}
	got := collectContent(t, out)
	if strings.Contains(got, "123-45-6789") {
		t.Fatalf("SSN leaked across chunks: %q", got)
	}
	if !strings.Contains(got, "<US_SSN>") {
		t.Fatalf("no SSN mask token: %q", got)
	}
	if !strings.HasPrefix(got, "My SSN is ") || !strings.HasSuffix(got, " ok") {
		t.Fatalf("surrounding text mangled: %q", got)
	}
}

func TestStreamPreservesCleanContent(t *testing.T) {
	parts := []string{"The ", "quick ", "brown ", "fox ", "jumps over the lazy dog."}
	var writes []string
	for _, p := range parts {
		writes = append(writes, sseEvent(p))
	}
	writes = append(writes, "data: [DONE]\n\n")
	out, masked := run(t, writes)
	if masked {
		t.Fatal("clean content should not be masked")
	}
	got := collectContent(t, out)
	want := "The quick brown fox jumps over the lazy dog."
	if got != want {
		t.Fatalf("clean content altered:\n got=%q\nwant=%q", got, want)
	}
}

func TestStreamFlushesWithoutDoneSentinel(t *testing.T) {
	// Stream ends abruptly (no [DONE]); Close() must still emit held content.
	out, _ := run(t, []string{sseEvent("hello world tail")})
	got := collectContent(t, out)
	if got != "hello world tail" {
		t.Fatalf("tail dropped without [DONE]: %q", got)
	}
}

func TestStreamForwardsNonContentLines(t *testing.T) {
	// Role-only opening delta + a comment line must pass through untouched.
	role := `data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}` + "\n\n"
	out, _ := run(t, []string{role, sseEvent("hi"), "data: [DONE]\n\n"})
	if !strings.Contains(out, `"role":"assistant"`) {
		t.Fatalf("role delta dropped: %q", out)
	}
	if !strings.Contains(out, "[DONE]") {
		t.Fatal("DONE sentinel dropped")
	}
}

func TestStreamMasksCreditCardSplitByWriteBoundary(t *testing.T) {
	// The SSE bytes themselves are split mid-line across two Write() calls.
	full := sseEvent("card 4111 1111 1111 1111 end") + "data: [DONE]\n\n"
	mid := len(full) / 2
	out, masked := run(t, []string{full[:mid], full[mid:]})
	if !masked {
		t.Fatal("expected credit card masked across write boundary")
	}
	got := collectContent(t, out)
	if strings.Contains(got, "4111 1111 1111 1111") {
		t.Fatalf("card leaked: %q", got)
	}
}
