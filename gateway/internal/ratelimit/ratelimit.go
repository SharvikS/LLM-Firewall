package ratelimit

import (
	"context"
	"fmt"
	"log/slog"
	"sync/atomic"
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

// RateLimiter is a distributed rate limiter backed by Redis.
// RPM uses a sliding-window sorted-set; TPM uses a 1-minute tumbling bucket.
// All operations are atomic via Lua scripts, safe across multiple replicas.
//
// The RPM and TPM limits are held atomically so the dashboard settings plane can
// retune them live (SetLimits) without restarting the gateway or racing the
// request path.
type RateLimiter struct {
	client   *redis.Client
	limit    atomic.Int64  // RPM limit
	window   time.Duration // RPM window
	tpmLimit atomic.Int64  // tokens per minute; 0 = TPM checking disabled
}

// New creates a RateLimiter.
//   limit    — maximum requests allowed in the RPM window
//   window   — the rolling RPM window duration
//   tpmLimit — maximum tokens per minute; 0 disables TPM enforcement
func New(client *redis.Client, limit int64, window time.Duration, tpmLimit int64) *RateLimiter {
	rl := &RateLimiter{client: client, window: window}
	rl.limit.Store(limit)
	rl.tpmLimit.Store(tpmLimit)
	return rl
}

// SetLimits live-updates the RPM and TPM limits. Safe to call concurrently with
// Allow/AllowTokens; in-flight windows simply observe the new value on their next
// evaluation. A TPM of 0 disables token enforcement.
func (rl *RateLimiter) SetLimits(rpm, tpm int64) {
	if rpm < 0 {
		rpm = 0
	}
	if tpm < 0 {
		tpm = 0
	}
	rl.limit.Store(rpm)
	rl.tpmLimit.Store(tpm)
}

// TPMLimit returns the current tokens-per-minute limit (0 = disabled). The proxy
// uses this to decide whether to run the TPM check at all.
func (rl *RateLimiter) TPMLimit() int64 { return rl.tpmLimit.Load() }

// Allow checks whether tenantID is within its rate limit.
// On any Redis error the limiter fails open (returns Allowed: true) and logs a
// warning — a Redis outage must never take the gateway down.
func (rl *RateLimiter) Allow(ctx context.Context, tenantID string) (Result, error) {
	return rl.AllowWithLimit(ctx, tenantID, rl.limit.Load())
}

// AllowWithLimit is Allow with an explicit per-tenant RPM limit (from the
// per-tenant settings plane). A limit of 0 disables RPM enforcement (always
// allowed). This lets each tenant carry its own quota without a shared global.
func (rl *RateLimiter) AllowWithLimit(ctx context.Context, tenantID string, limit int64) (Result, error) {
	if limit <= 0 {
		return Result{Allowed: true, Limit: 0, Remaining: 0}, nil
	}
	key := fmt.Sprintf("gateway:rl:%s", tenantID)
	nowMs := time.Now().UnixMilli()
	windowMs := rl.window.Milliseconds()
	member := uuid.New().String() // unique per request to avoid sorted-set collisions

	vals, err := slidingWindowScript.Run(
		ctx, rl.client,
		[]string{key},
		nowMs, windowMs, limit, member,
	).Slice()

	if err != nil {
		logger.Get().Warn("rate limiter redis error — failing open",
			slog.String("tenant", tenantID),
			slog.String("error", err.Error()),
		)
		return Result{Allowed: true, Limit: limit}, err
	}

	allowed := toInt64(vals[0]) == 1
	current := toInt64(vals[1])
	limit = toInt64(vals[2])

	return Result{
		Allowed:   allowed,
		Current:   current,
		Limit:     limit,
		Remaining: max(0, limit-current),
	}, nil
}

// tpmScript is an atomic Lua script for a tumbling-window TPM counter.
//
// KEYS[1]  — token bucket key for this tenant+minute  (e.g. "gateway:tpm:tenant_123:28123456")
// ARGV[1]  — TPM limit
// ARGV[2]  — tokens consumed by this request
//
// Returns {allowed int, current int, limit int}
//
// Correctness note: we GET before INCRBY so that a rejected over-limit
// request does NOT consume quota.  A single huge rejected request can no
// longer starve legitimate follow-up traffic within the same minute window.
var tpmScript = redis.NewScript(`
local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local tokens = tonumber(ARGV[2])

-- Peek at current usage WITHOUT consuming quota yet.
local current = tonumber(redis.call('GET', key) or '0')
if current + tokens > limit then
    return {0, current, limit}
end

-- Within budget: commit the increment atomically.
local new_total = redis.call('INCRBY', key, tokens)
if new_total == tokens then
    -- First write in this minute bucket — set expiry to 2 minutes so the key
    -- auto-evicts after the window rolls over.
    redis.call('EXPIRE', key, 120)
end
return {1, new_total, limit}
`)

// AllowTokens checks whether tenantID is within its per-minute token quota.
// The window is a 1-minute tumbling bucket (key includes the Unix minute).
// Fails open on Redis error — same policy as Allow.
func (rl *RateLimiter) AllowTokens(ctx context.Context, tenantID string, tokens int64) (Result, error) {
	return rl.AllowTokensWithLimit(ctx, tenantID, tokens, rl.tpmLimit.Load())
}

// AllowTokensWithLimit is AllowTokens with an explicit per-tenant TPM limit.
// A limit of 0 disables token enforcement (always allowed).
func (rl *RateLimiter) AllowTokensWithLimit(ctx context.Context, tenantID string, tokens, tpmLimit int64) (Result, error) {
	if tpmLimit <= 0 {
		return Result{Allowed: true, Limit: 0, Remaining: 0}, nil
	}
	minuteBucket := time.Now().Unix() / 60
	key := fmt.Sprintf("gateway:tpm:%s:%d", tenantID, minuteBucket)

	vals, err := tpmScript.Run(
		ctx, rl.client,
		[]string{key},
		tpmLimit, tokens,
	).Slice()

	if err != nil {
		logger.Get().Warn("tpm limiter redis error — failing open",
			slog.String("tenant", tenantID),
			slog.String("error", err.Error()),
		)
		return Result{Allowed: true, Limit: tpmLimit}, err
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
