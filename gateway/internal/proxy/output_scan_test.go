package proxy

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBufferingResponseFinalizeRewrite(t *testing.T) {
	rec := httptest.NewRecorder()
	bw := newBufferingResponse(rec)
	bw.Header().Set("Content-Type", "application/json")
	bw.WriteHeader(200)
	bw.Write([]byte(`{"original":true}`))

	// Finalize with a rewritten (longer) body — Content-Length must be corrected.
	bw.finalize([]byte(`{"rewritten":"masked-content"}`))

	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := rec.Body.String(); got != `{"rewritten":"masked-content"}` {
		t.Fatalf("body = %q, want rewritten body", got)
	}
	if cl := res.Header.Get("Content-Length"); cl != "30" {
		t.Fatalf("Content-Length = %q, want 30", cl)
	}
}

func TestBufferingResponseOverflowStreams(t *testing.T) {
	rec := httptest.NewRecorder()
	bw := newBufferingResponse(rec)
	bw.WriteHeader(200)
	// Write more than maxCacheBodyBytes so it switches to passthrough streaming.
	big := strings.Repeat("x", maxCacheBodyBytes+1024)
	bw.Write([]byte(big))
	bw.finalize(nil) // no-op once overflowed

	if !bw.overflowed {
		t.Fatal("expected overflow")
	}
	if rec.Body.Len() != len(big) {
		t.Fatalf("streamed %d bytes, want %d", rec.Body.Len(), len(big))
	}
}

// rewriteChoices is the pure JSON-rewrite half of scanResponseBody, exercised
// here with a stub masker so the logic is covered without a live ML engine.
func TestScanResponseRewriteShape(t *testing.T) {
	body := []byte(`{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"email me at a@b.com"}}],"usage":{"total_tokens":5}}`)
	stub := func(text string) (string, bool) {
		if text == "email me at a@b.com" {
			return "email me at <EMAIL_ADDRESS>", true
		}
		return text, false
	}
	out, did := rewriteAssistantContent(body, stub)
	if !did {
		t.Fatal("expected a mask to be applied")
	}
	masked := string(out)
	if !strings.Contains(masked, "<EMAIL_ADDRESS>") {
		t.Fatalf("content not masked: %s", masked)
	}
	// Unknown fields must survive the round-trip.
	if !strings.Contains(masked, `"total_tokens"`) || !strings.Contains(masked, `"id"`) {
		t.Fatalf("rewrite dropped fields: %s", masked)
	}
}

func TestScanResponseNoChoicesIsNoop(t *testing.T) {
	body := []byte(`{"error":{"message":"bad"}}`)
	out, did := rewriteAssistantContent(body, func(s string) (string, bool) { return "X", true })
	if did || string(out) != string(body) {
		t.Fatalf("non-chat body must pass through unchanged, got did=%v body=%s", did, out)
	}
}
