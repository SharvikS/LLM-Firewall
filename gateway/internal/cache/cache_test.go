package cache

import (
	"testing"
)

// ── IsStreaming ───────────────────────────────────────────────────────────────

func TestIsStreaming(t *testing.T) {
	tests := []struct {
		name string
		body []byte
		want bool
	}{
		{
			name: "stream_true",
			body: []byte(`{"model":"gpt-4","stream":true,"messages":[]}`),
			want: true,
		},
		{
			name: "stream_false",
			body: []byte(`{"model":"gpt-4","stream":false,"messages":[]}`),
			want: false,
		},
		{
			name: "stream_absent_defaults_false",
			body: []byte(`{"model":"gpt-4","messages":[]}`),
			want: false,
		},
		{
			name: "empty_body_returns_false",
			body: []byte{},
			want: false,
		},
		{
			name: "nil_body_returns_false",
			body: nil,
			want: false,
		},
		{
			name: "invalid_json_returns_false",
			body: []byte(`not-json`),
			want: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsStreaming(tc.body)
			if got != tc.want {
				t.Errorf("IsStreaming(%q) = %v; want %v", tc.body, got, tc.want)
			}
		})
	}
}

// ── Cache.Key ─────────────────────────────────────────────────────────────────

func TestCacheKey(t *testing.T) {
	c := &Cache{} // Key() has no fields — only hashes inputs

	t.Run("deterministic", func(t *testing.T) {
		k1 := c.Key("tenant-a", "/v1/chat", []byte(`{"prompt":"hello"}`))
		k2 := c.Key("tenant-a", "/v1/chat", []byte(`{"prompt":"hello"}`))
		if k1 != k2 {
			t.Errorf("same inputs produced different keys: %s vs %s", k1, k2)
		}
	})

	t.Run("different_tenants_produce_different_keys", func(t *testing.T) {
		k1 := c.Key("tenant-a", "/v1/chat", []byte(`{"prompt":"hello"}`))
		k2 := c.Key("tenant-b", "/v1/chat", []byte(`{"prompt":"hello"}`))
		if k1 == k2 {
			t.Error("different tenants must not share a cache entry")
		}
	})

	t.Run("different_paths_produce_different_keys", func(t *testing.T) {
		k1 := c.Key("tenant-a", "/v1/chat/completions", []byte(`{"prompt":"hello"}`))
		k2 := c.Key("tenant-a", "/v1/embeddings", []byte(`{"prompt":"hello"}`))
		if k1 == k2 {
			t.Error("/v1/chat/completions and /v1/embeddings must not share a cache entry")
		}
	})

	t.Run("different_bodies_produce_different_keys", func(t *testing.T) {
		k1 := c.Key("t", "/v1/chat", []byte(`{"prompt":"hello"}`))
		k2 := c.Key("t", "/v1/chat", []byte(`{"prompt":"world"}`))
		if k1 == k2 {
			t.Error("different prompt bodies must produce different cache keys")
		}
	})

	t.Run("key_has_gateway_prefix", func(t *testing.T) {
		k := c.Key("t", "/v1/chat", []byte("body"))
		if len(k) < 16 {
			t.Errorf("cache key too short: %q", k)
		}
		// Key format: "gateway:cache:<hex>"
		if k[:14] != "gateway:cache:" {
			t.Errorf("cache key missing prefix, got: %q", k[:14])
		}
	})
}
