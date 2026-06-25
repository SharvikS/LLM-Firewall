package siem

import (
	"testing"
	"time"
)

func TestEnvelopeGenericIncludesStableEvent(t *testing.T) {
	ev := Event{
		SchemaVersion: SchemaVersion,
		Vendor:        "titan",
		Product:       "titan-gateway",
		EventType:     "security",
		EventAction:   "ML_BLOCKED",
		Severity:      Severity("ML_BLOCKED", 97),
		Category:      Category("ML_BLOCKED"),
		TenantID:      "tenant-1",
		RequestID:     "req-1",
		RiskScore:     97,
		Reason:        "prompt injection",
		Timestamp:     time.Unix(1700000000, 0).UTC(),
	}
	ev.Message = Message(ev)

	payload := Envelope(FormatGeneric, ev)
	if payload["text"] == "" {
		t.Fatal("generic envelope should include text for Slack/Teams-style webhooks")
	}
	got, ok := payload["event"].(Event)
	if !ok {
		t.Fatalf("event payload type = %T, want siem.Event", payload["event"])
	}
	if got.SchemaVersion != SchemaVersion {
		t.Fatalf("schema_version = %q, want %q", got.SchemaVersion, SchemaVersion)
	}
}

func TestEnvelopeSplunkHEC(t *testing.T) {
	ev := Event{
		SchemaVersion: SchemaVersion,
		EventAction:   "QUOTA_EXCEEDED",
		Severity:      Severity("QUOTA_EXCEEDED", 0),
		Category:      Category("QUOTA_EXCEEDED"),
		Timestamp:     time.Unix(1700000000, 0).UTC(),
	}

	payload := Envelope("splunk", ev)
	if payload["sourcetype"] != "titan:security" {
		t.Fatalf("sourcetype = %v, want titan:security", payload["sourcetype"])
	}
	if _, ok := payload["time"].(float64); !ok {
		t.Fatalf("time type = %T, want float64", payload["time"])
	}
	if payload["event"] == nil {
		t.Fatal("splunk envelope missing event")
	}
}

func TestNormalizeFormat(t *testing.T) {
	cases := map[string]string{
		"":           FormatGeneric,
		"unknown":    FormatGeneric,
		"splunk":     FormatSplunkHEC,
		"splunk_hec": FormatSplunkHEC,
		"datadog":    FormatDatadog,
		"ecs":        FormatElastic,
	}
	for in, want := range cases {
		if got := NormalizeFormat(in); got != want {
			t.Fatalf("NormalizeFormat(%q)=%q, want %q", in, got, want)
		}
	}
}
