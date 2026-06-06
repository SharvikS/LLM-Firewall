// Package metrics — Redis reporter for distributed, persistent metrics.
//
// Call Init(client) once at startup to activate Redis mode.  Until then,
// all metrics remain local (in-process atomics) and the GlobalSnapshot
// falls back to local values — safe for single-replica dev setups.
package metrics

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// ---------------------------------------------------------------------------
// Redis key constants — shared with collector.go (same package)
// ---------------------------------------------------------------------------

const (
	latencyKey = "gateway:latency:samples"
	trafficPfx = "gateway:traffic:"
)

var counterKeys = [9]string{
	"gateway:metrics:total_requests",
	"gateway:metrics:allowed_requests",
	"gateway:metrics:blocked_requests",
	"gateway:metrics:rate_limited",
	"gateway:metrics:cache_hits",
	"gateway:metrics:cache_misses",
	"gateway:metrics:ml_blocked",
	"gateway:metrics:pii_masked",
	"gateway:metrics:cedar_blocked",
}

// ---------------------------------------------------------------------------
// Channels: collector.go sends, reporter drains in batches
//
// Both channels are buffered.  Sends are non-blocking (select/default) so
// a slow Redis flush never blocks the hot request path.  Drops are
// acceptable — a missed sample or event is far better than added latency.
// ---------------------------------------------------------------------------

const eventsKey = "gateway:events"

var (
	latencySamples = make(chan int64, 2048)
	trafficEvents  = make(chan bool, 2048)
	eventQueue     = make(chan Event, 512) // live threat feed, cluster-wide
	redisClient    *redis.Client
)

// MetricsSnapshot is the aggregate view of all gateway replicas read from
// Redis.  Falls back to local in-process values if Redis is unavailable.
type MetricsSnapshot struct {
	TotalRequests   int64
	AllowedRequests int64
	BlockedRequests int64
	RateLimited     int64
	CacheHits       int64
	CacheMisses     int64
	MLBlocked       int64
	PIIMasked       int64
	CedarBlocked    int64
	P99LatencyMs    int64
	AvgLatencyMs    float64
	TrafficChart    []TrafficPoint
}

// Init wires Redis into the metrics package and starts the background
// flush goroutine.  Must be called once at startup after Redis is reachable.
func Init(client *redis.Client) {
	redisClient = client
	go runReporter()
	logger.Get().Info("metrics: Redis reporter active — distributed mode enabled")
}

// ---------------------------------------------------------------------------
// Background flush loop — drains channels and pushes deltas every 5 s
// ---------------------------------------------------------------------------

func runReporter() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	var prev [9]int64
	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		flushAll(ctx, &prev)
		cancel()
	}
}

func flushAll(ctx context.Context, prev *[9]int64) {
	pipe := redisClient.Pipeline()

	// 1. Counter deltas — one INCRBY per changed counter
	current := [9]int64{
		Global.TotalRequests.Load(), Global.AllowedRequests.Load(),
		Global.BlockedRequests.Load(), Global.RateLimited.Load(),
		Global.CacheHits.Load(), Global.CacheMisses.Load(),
		Global.MLBlocked.Load(), Global.PIIMasked.Load(),
		Global.CedarBlocked.Load(),
	}
	for i, cur := range current {
		if delta := cur - prev[i]; delta > 0 {
			pipe.IncrBy(ctx, counterKeys[i], delta)
			prev[i] = cur
		}
	}

	// 2. Latency samples — drain channel, one RPUSH + LTRIM
	var latSamples []interface{}
drain1:
	for {
		select {
		case ms := <-latencySamples:
			latSamples = append(latSamples, ms)
		default:
			break drain1
		}
	}
	if len(latSamples) > 0 {
		pipe.RPush(ctx, latencyKey, latSamples...)
		pipe.LTrim(ctx, latencyKey, -1000, -1) // keep last 1000 samples
	}

	// 3. Traffic events — aggregate by hour bucket, then HINCRBY
	bucketR := make(map[string]int64)
	bucketB := make(map[string]int64)
drain2:
	for {
		select {
		case isBlocked := <-trafficEvents:
			bucket := time.Now().Format("2006010215") // YYYYMMDDHH
			bucketR[bucket]++
			if isBlocked {
				bucketB[bucket]++
			}
		default:
			break drain2
		}
	}
	for bucket, r := range bucketR {
		key := trafficPfx + bucket
		pipe.HIncrBy(ctx, key, "r", r)
		if b := bucketB[bucket]; b > 0 {
			pipe.HIncrBy(ctx, key, "b", b)
		}
		pipe.Expire(ctx, key, 50*time.Hour)
	}

	// 4. Live threat feed — serialize events and LPUSH to cluster-wide Redis list.
	// LPUSH pushes newest-first, so LRANGE 0..N returns most recent events first.
	var eventPayloads []interface{}
drain3:
	for {
		select {
		case e := <-eventQueue:
			data, err := json.Marshal(e)
			if err == nil {
				eventPayloads = append(eventPayloads, string(data))
			}
		default:
			break drain3
		}
	}
	if len(eventPayloads) > 0 {
		pipe.LPush(ctx, eventsKey, eventPayloads...)
		pipe.LTrim(ctx, eventsKey, 0, 199) // keep the 200 most recent events
	}

	if _, err := pipe.Exec(ctx); err != nil {
		logger.Get().Warn("metrics flush to Redis failed",
			slog.String("error", err.Error()))
	}
}

// ---------------------------------------------------------------------------
// GlobalSnapshot — reads aggregate metrics from Redis, local fallback
// ---------------------------------------------------------------------------

// GlobalSnapshot returns the cross-replica aggregate of all metrics.
// If Redis is unavailable it falls back to in-process counters.
func GlobalSnapshot(ctx context.Context) MetricsSnapshot {
	if redisClient == nil {
		return localSnapshot()
	}
	vals, err := redisClient.MGet(ctx, counterKeys[:]...).Result()
	if err != nil {
		logger.Get().Warn("metrics MGET failed — serving local counters",
			slog.String("error", err.Error()))
		return localSnapshot()
	}

	snap := MetricsSnapshot{}
	targets := []*int64{
		&snap.TotalRequests, &snap.AllowedRequests, &snap.BlockedRequests,
		&snap.RateLimited, &snap.CacheHits, &snap.CacheMisses,
		&snap.MLBlocked, &snap.PIIMasked, &snap.CedarBlocked,
	}
	for i, v := range vals {
		if s, ok := v.(string); ok {
			if n, err := strconv.ParseInt(s, 10, 64); err == nil {
				*targets[i] = n
			}
		}
	}
	snap.P99LatencyMs, snap.AvgLatencyMs = redisLatencyStats(ctx)
	snap.TrafficChart = redisTrafficSnapshot(ctx)
	return snap
}

func localSnapshot() MetricsSnapshot {
	return MetricsSnapshot{
		TotalRequests:   Global.TotalRequests.Load(),
		AllowedRequests: Global.AllowedRequests.Load(),
		BlockedRequests: Global.BlockedRequests.Load(),
		RateLimited:     Global.RateLimited.Load(),
		CacheHits:       Global.CacheHits.Load(),
		CacheMisses:     Global.CacheMisses.Load(),
		MLBlocked:       Global.MLBlocked.Load(),
		PIIMasked:       Global.PIIMasked.Load(),
		CedarBlocked:    Global.CedarBlocked.Load(),
		P99LatencyMs:    Latency.P99(),
		AvgLatencyMs:    Latency.Avg(),
		TrafficChart:    HourlyTraffic.Snapshot(),
	}
}

func redisLatencyStats(ctx context.Context) (p99 int64, avg float64) {
	vals, err := redisClient.LRange(ctx, latencyKey, 0, -1).Result()
	if err != nil || len(vals) == 0 {
		return Latency.P99(), Latency.Avg()
	}
	samples := make([]int64, 0, len(vals))
	var sum int64
	for _, v := range vals {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			samples = append(samples, n)
			sum += n
		}
	}
	if len(samples) == 0 {
		return 0, 0
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	idx := int(float64(len(samples)) * 0.99)
	if idx >= len(samples) {
		idx = len(samples) - 1
	}
	return samples[idx], float64(sum) / float64(len(samples))
}

// GlobalEvents returns the N most recent threat events from the cluster-wide
// Redis list.  Falls back to the local in-process ring buffer if Redis is
// unavailable so single-replica deployments still work correctly.
func GlobalEvents(ctx context.Context, n int) []Event {
	if redisClient == nil {
		return Events.Last(n)
	}
	vals, err := redisClient.LRange(ctx, eventsKey, 0, int64(n-1)).Result()
	if err != nil || len(vals) == 0 {
		return Events.Last(n)
	}
	out := make([]Event, 0, len(vals))
	for _, v := range vals {
		var e Event
		if err := json.Unmarshal([]byte(v), &e); err == nil {
			out = append(out, e)
		}
	}
	return out
}

func redisTrafficSnapshot(ctx context.Context) []TrafficPoint {
	now := time.Now()
	pipe := redisClient.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, 48)
	for i := 0; i < 48; i++ {
		t := now.Add(time.Duration(i-47) * time.Hour)
		bucket := t.Format("2006010215")
		cmds[i] = pipe.HGetAll(ctx, trafficPfx+bucket)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return HourlyTraffic.Snapshot()
	}
	out := make([]TrafficPoint, 48)
	for i, cmd := range cmds {
		t := now.Add(time.Duration(i-47) * time.Hour)
		data := cmd.Val()
		var req, blocked int64
		if v, ok := data["r"]; ok {
			req, _ = strconv.ParseInt(v, 10, 64)
		}
		if v, ok := data["b"]; ok {
			blocked, _ = strconv.ParseInt(v, 10, 64)
		}
		out[i] = TrafficPoint{Label: t.Format("15:00"), Requests: req, Blocked: blocked}
	}
	return out
}
