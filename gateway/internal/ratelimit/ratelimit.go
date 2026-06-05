package ratelimit

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// slidingWindowScript is an atomic Lua script that implements a sliding-window
// rate limiter using a Redis sorted set.
//
// KEYS[1]  — the rate-limit key for this tenant  (e.g. "gateway:rl:tenant_123")
// ARGV[1]  — current Unix time in milliseconds
// ARGV[2]  — window size in milliseconds
// ARGV[3]  — maximum requests allowed per window
// ARGV[4]  — unique identifier for this request (prevents member collisions)
//
// Returns {allowed int, current int, limit int}
//   allowed = 1  → request is within the limit
//   allowed = 0  → limit exceeded
var slidingWindowScript = redis.NewScript(`
local key        = KEYS[1]
local now        = tonumber(ARGV[1])
local window_ms  = tonumber(ARGV[2])
local limit      = tonumber(ARGV[3])
local member     = ARGV[4]

-- Evict entries that have fallen outside the current window.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window_ms)

local count = redis.call('ZCARD', key)

if count >= limit then
    return {0, count, limit}
end

redis.call('ZADD',    key, now, member)
redis.call('PEXPIRE', key, window_ms + 1000)

return {1, count + 1, limit}
`)

// Result carries the outcome of a single Allow call.
type Result struct {
	Allowed   bool
	Current   int64 // requests used in the current window
	Limit     int64 // configured limit
	Remaining int64 // Limit - Current
}

// RateLimiter is a distributed sliding-window limiter backed by Redis.
// All calls are atomic via a Lua script, so they are safe across multiple
// gateway replicas sharing the same Redis instance.
type RateLimiter struct {
	client *redis.Client
	limit  int64
	window time.Duration
}

// New creates a RateLimiter.
//   limit  — maximum requests allowed in the window
//   window — the rolling window duration
func New(client *redis.Client, limit int64, window time.Duration) *RateLimiter {
	return &RateLimiter{client: client, limit: limit, window: window}
}

// Allow checks whether tenantID is within its rate limit.
// On any Redis error the limiter fails open (returns Allowed: true) and logs a
// warning — a Redis outage must never take the gateway down.
func (rl *RateLimiter) Allow(ctx context.Context, tenantID string) (Result, error) {
	key := fmt.Sprintf("gateway:rl:%s", tenantID)
	nowMs := time.Now().UnixMilli()
	windowMs := rl.window.Milliseconds()
	member := uuid.New().String() // unique per request to avoid sorted-set collisions

	vals, err := slidingWindowScript.Run(
		ctx, rl.client,
		[]string{key},
		nowMs, windowMs, rl.limit, member,
	).Slice()

	if err != nil {
		logger.Get().Warn("rate limiter redis error — failing open",
			slog.String("tenant", tenantID),
			slog.String("error", err.Error()),
		)
		return Result{Allowed: true, Limit: rl.limit}, err
	}

	allowed := toInt64(vals[0]) == 1
	current := toInt64(vals[1])
	limit := toInt64(vals[2])

	return Result{
		Allowed:   allowed,
		Current:   current,
		Limit:     limit,
		Remaining: max(0, limit-current),
	}, nil
}

func toInt64(v interface{}) int64 {
	if i, ok := v.(int64); ok {
		return i
	}
	return 0
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
