package cache

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
type Cache struct {
	client *redis.Client
	ttl    time.Duration
}

// New creates a Cache with the given TTL for all entries.
func New(client *redis.Client, ttl time.Duration) *Cache {
	return &Cache{client: client, ttl: ttl}
}

// Key returns a deterministic cache key for the tuple (tenantID, path, body).
// The SHA-256 digest ensures the key length is bounded regardless of body size.
func (c *Cache) Key(tenantID, path string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(tenantID))
	h.Write([]byte("|"))
	h.Write([]byte(path))
	h.Write([]byte("|"))
	h.Write(body)
	return fmt.Sprintf("gateway:cache:%x", h.Sum(nil))
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
	if err := c.client.Set(ctx, key, raw, c.ttl).Err(); err != nil {
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
