package cache

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// entry is what we actually persist in Redis. Storing the status code alongside
// the body lets us faithfully replay non-200 responses if needed (currently we
// only cache 200s, but the field future-proofs the format).
type entry struct {
	StatusCode  int               `json:"s"`
	Headers     map[string]string `json:"h"`
	Body        []byte            `json:"b"`
}

// Cache is an exact-match request/response cache backed by Redis.
// Streaming responses must never be cached; callers are responsible for
// skipping cache operations when stream=true.
//
// The TTL is stored atomically (as nanoseconds) so the dashboard settings plane
// can retune it live via SetTTL without restarting the gateway.
type Cache struct {
	client *redis.Client
	ttlNs  atomic.Int64
}

// New creates a Cache with the given TTL for all entries.
func New(client *redis.Client, ttl time.Duration) *Cache {
	c := &Cache{client: client}
	c.ttlNs.Store(int64(ttl))
	return c
}

// SetTTL live-updates the cache entry TTL. A non-positive duration is clamped to
// 1 second to avoid writing entries that expire immediately.
func (c *Cache) SetTTL(ttl time.Duration) {
	if ttl <= 0 {
		ttl = time.Second
	}
	c.ttlNs.Store(int64(ttl))
}

// Key returns a deterministic cache key for the tuple (tenantID, path, body).
// The body is JSON-normalised before hashing so that semantically identical
// requests with different key ordering (e.g. {"a":1,"b":2} vs {"b":2,"a":1})
// produce the same key.  The SHA-256 digest bounds the key length regardless
// of body size.
func (c *Cache) Key(tenantID, path string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(tenantID))
	h.Write([]byte("|"))
	h.Write([]byte(path))
	h.Write([]byte("|"))
	h.Write(normalizeBody(body))
	return fmt.Sprintf("gateway:cache:%x", h.Sum(nil))
}

// normalizeBody round-trips JSON through encoding/json so map keys are sorted
// alphabetically, making the hash key-order-independent.  Non-JSON bodies are
// returned as-is (e.g. plain-text or empty requests).
func normalizeBody(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	var m interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		return body
	}
	normalized, err := json.Marshal(m)
	if err != nil {
		return body
	}
	return normalized
}

// Get retrieves a cached response. Returns (entry, true, nil) on a hit,
// (nil, false, nil) on a miss, and (nil, false, err) on a Redis error.
// On any Redis error the caller should treat it as a cache miss (fail open).
func (c *Cache) Get(ctx context.Context, key string) (*entry, bool, error) {
	raw, err := c.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		logger.Get().Warn("cache GET error — treating as miss",
			slog.String("key", key),
			slog.String("error", err.Error()),
		)
		return nil, false, err
	}

	var e entry
	if err := json.Unmarshal(raw, &e); err != nil {
		// Corrupt entry — evict it and treat as a miss.
		c.client.Del(ctx, key) //nolint:errcheck
		return nil, false, nil
	}
	return &e, true, nil
}

// Set stores a response in the cache.  Only call this for successful (200)
// non-streaming responses. Errors are logged and swallowed — a cache write
// failure must not break the request path.
func (c *Cache) Set(ctx context.Context, key string, statusCode int, headers map[string]string, body []byte) {
	e := entry{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       body,
	}
	raw, err := json.Marshal(e)
	if err != nil {
		logger.Get().Error("cache serialisation failed",
			slog.String("key", key),
			slog.String("error", err.Error()),
		)
		return
	}
	if err := c.client.Set(ctx, key, raw, time.Duration(c.ttlNs.Load())).Err(); err != nil {
		logger.Get().Warn("cache SET error",
			slog.String("key", key),
			slog.String("error", err.Error()),
		)
	}
}

// IsStreaming reports whether a parsed request body contains "stream": true.
// A JSON parse error or missing field returns false (treat as non-streaming).
func IsStreaming(body []byte) bool {
	if len(body) == 0 {
		return false
	}
	var req struct {
		Stream bool `json:"stream"`
	}
	json.Unmarshal(body, &req) //nolint:errcheck — default false on error is correct
	return req.Stream
}

// Entry re-exports the private type so proxy.go can reference it.
type Entry = entry
