package api

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

func TestAuditCursorRoundTrip(t *testing.T) {
	orig := &store.AuditCursor{
		CreatedAt: time.Date(2026, 6, 10, 14, 30, 45, 123456789, time.UTC),
		ID:        uuid.New(),
	}
	encoded := encodeAuditCursor(orig)
	if encoded == "" {
		t.Fatal("non-nil cursor must encode to non-empty string")
	}

	decoded, err := decodeAuditCursor(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !decoded.CreatedAt.Equal(orig.CreatedAt) || decoded.ID != orig.ID {
		t.Fatalf("round-trip mismatch: got %+v, want %+v", decoded, orig)
	}
}

func TestAuditCursorNilAndEmpty(t *testing.T) {
	if encodeAuditCursor(nil) != "" {
		t.Fatal("nil cursor must encode to empty string")
	}
	c, err := decodeAuditCursor("")
	if err != nil || c != nil {
		t.Fatalf("empty cursor must decode to nil, got %v / %v", c, err)
	}
}

func TestAuditCursorRejectsGarbage(t *testing.T) {
	for _, bad := range []string{
		"not-base64!!!",
		"bm8tcGlwZS1oZXJl",         // base64("no-pipe-here")
		"MjAyNi0wMS0wMXxub3QtdXVpZA", // base64("2026-01-01|not-uuid")
	} {
		if _, err := decodeAuditCursor(bad); err == nil {
			t.Errorf("decodeAuditCursor(%q) should fail", bad)
		}
	}
}
