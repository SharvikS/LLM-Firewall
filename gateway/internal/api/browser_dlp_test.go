package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMapBrowserAction(t *testing.T) {
	cases := []struct {
		action, decision string
		wantAction       string
		wantBlocked      bool
	}{
		{"blocked", "block", "BROWSER_DLP_BLOCK", true},
		{"cancelled", "redact", "BROWSER_DLP_BLOCK", true},
		{"redacted", "redact", "BROWSER_DLP_REDACT", true},
		{"auto_redacted", "redact", "BROWSER_DLP_REDACT", true},
		{"sent_anyway", "redact", "BROWSER_DLP_OVERRIDE", false},
		{"", "allow", "BROWSER_DLP_CLEAN", false},
		{"weird", "block", "BROWSER_DLP_BLOCK", true},
	}
	for _, c := range cases {
		gotAction, gotBlocked := mapBrowserAction(browserDLPEvent{Action: c.action, Decision: c.decision})
		if gotAction != c.wantAction || gotBlocked != c.wantBlocked {
			t.Errorf("mapBrowserAction(%q,%q) = (%q,%v); want (%q,%v)",
				c.action, c.decision, gotAction, gotBlocked, c.wantAction, c.wantBlocked)
		}
	}
}

// Report must never panic with nil producer/alerts (Kafka/alerting disabled)
// and must enforce the shared token when one is configured.
func TestBrowserDLPReport(t *testing.T) {
	h := NewBrowserDLPHandler(nil, nil, nil, 3, "")

	body := `{"site":"chatgpt","decision":"redact","action":"redacted","risk":60,"reason":"PII: EMAIL_ADDRESS","pii":["EMAIL_ADDRESS"]}`
	req := httptest.NewRequest(http.MethodPost, "/internal/dlp-event", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Report(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (%s)", rec.Code, rec.Body.String())
	}

	// With a token configured, a missing/wrong header is rejected.
	hTok := NewBrowserDLPHandler(nil, nil, nil, 3, "s3cret")
	req2 := httptest.NewRequest(http.MethodPost, "/internal/dlp-event", strings.NewReader(body))
	rec2 := httptest.NewRecorder()
	hTok.Report(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec2.Code)
	}

	req3 := httptest.NewRequest(http.MethodPost, "/internal/dlp-event", strings.NewReader(body))
	req3.Header.Set("X-Titan-DLP-Token", "s3cret")
	rec3 := httptest.NewRecorder()
	hTok.Report(rec3, req3)
	if rec3.Code != http.StatusAccepted {
		t.Fatalf("expected 202 with valid token, got %d", rec3.Code)
	}
}
