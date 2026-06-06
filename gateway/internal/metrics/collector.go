// Package metrics provides process-wide counters and an in-memory event ring
// buffer that the dashboard polls via /api/metrics and /api/events.
package metrics

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Counters are all lock-free atomic integers so recording a metric on the
// hot request path has zero contention cost.
type Counters struct {
	TotalRequests   atomic.Int64
	AllowedRequests atomic.Int64
	BlockedRequests atomic.Int64 // policy + ML combined
	RateLimited     atomic.Int64
	CacheHits       atomic.Int64
	CacheMisses     atomic.Int64
	MLBlocked       atomic.Int64
	PIIMasked       atomic.Int64
	CedarBlocked    atomic.Int64
}

// Global is the single process-wide counter set. All packages write here.
var Global = &Counters{}

// StartTime is set once at process start for uptime calculation.
var StartTime = time.Now()

// ---------------------------------------------------------------------------
// P99 Latency tracker — rolling window of the last 1000 samples
// ---------------------------------------------------------------------------

type LatencyTracker struct {
	mu      sync.Mutex
	samples []int64
	maxSize int
}

var Latency = NewLatencyTracker(1000)

func NewLatencyTracker(maxSize int) *LatencyTracker {
	return &LatencyTracker{maxSize: maxSize, samples: make([]int64, 0, maxSize)}
}

func (lt *LatencyTracker) Record(ms int64) {
	lt.mu.Lock()
	if len(lt.samples) >= lt.maxSize {
		lt.samples = lt.samples[1:]
	}
	lt.samples = append(lt.samples, ms)
	lt.mu.Unlock()

	// Non-blocking send to Redis reporter; drop if channel full.
	select {
	case latencySamples <- ms:
	default:
	}
}

// P99 returns the 99th-percentile latency in milliseconds over the window.
func (lt *LatencyTracker) P99() int64 {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	if len(lt.samples) == 0 {
		return 0
	}
	sorted := make([]int64, len(lt.samples))
	copy(sorted, lt.samples)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(float64(len(sorted)) * 0.99)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// Avg returns the mean latency over the window.
func (lt *LatencyTracker) Avg() float64 {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	if len(lt.samples) == 0 {
		return 0
	}
	var sum int64
	for _, s := range lt.samples {
		sum += s
	}
	return float64(sum) / float64(len(lt.samples))
}

// ---------------------------------------------------------------------------
// Event ring buffer — recent request events for the Live Threat Feed
// ---------------------------------------------------------------------------

type Event struct {
	EventID   string    `json:"event_id"`
	RequestID string    `json:"request_id"`
	TenantID  string    `json:"tenant_id"`
	Action    string    `json:"action"` // ALLOWED, BLOCKED, RATE_LIMITED, ML_BLOCKED, CACHE_HIT, PII_MASKED
	RiskScore float64   `json:"risk_score"`
	LatencyMs int64     `json:"latency_ms"`
	Timestamp time.Time `json:"timestamp"`
	Reason    string    `json:"reason,omitempty"`
	Path      string    `json:"path,omitempty"`
}

type EventRingBuffer struct {
	mu     sync.RWMutex
	events []Event
	size   int
}

var Events = NewEventRingBuffer(200)

func NewEventRingBuffer(size int) *EventRingBuffer {
	return &EventRingBuffer{size: size, events: make([]Event, 0, size)}
}

func (rb *EventRingBuffer) Push(e Event) {
	if e.EventID == "" {
		e.EventID = uuid.New().String()
	}
	rb.mu.Lock()
	defer rb.mu.Unlock()
	if len(rb.events) >= rb.size {
		rb.events = rb.events[1:]
	}
	rb.events = append(rb.events, e)
}

// Last returns up to n most-recent events in reverse-chronological order.
func (rb *EventRingBuffer) Last(n int) []Event {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	total := len(rb.events)
	if n > total {
		n = total
	}
	result := make([]Event, n)
	for i := 0; i < n; i++ {
		result[i] = rb.events[total-1-i]
	}
	return result
}

// ---------------------------------------------------------------------------
// Hourly traffic buckets — 48-bucket sliding window for the chart
// ---------------------------------------------------------------------------

type HourlyBucket struct {
	mu         sync.Mutex
	buckets    [48]struct{ Requests, Blocked int64 }
	currentIdx int
	lastHour   int
}

var HourlyTraffic = &HourlyBucket{lastHour: time.Now().Hour()}

func (hb *HourlyBucket) Record(blocked bool) {
	hb.mu.Lock()
	now := time.Now().Hour()
	if now != hb.lastHour {
		hb.currentIdx = (hb.currentIdx + 1) % 48
		hb.buckets[hb.currentIdx].Requests = 0
		hb.buckets[hb.currentIdx].Blocked = 0
		hb.lastHour = now
	}
	hb.buckets[hb.currentIdx].Requests++
	if blocked {
		hb.buckets[hb.currentIdx].Blocked++
	}
	hb.mu.Unlock()

	// Non-blocking send to Redis reporter; drop if channel full.
	select {
	case trafficEvents <- blocked:
	default:
	}
}

type TrafficPoint struct {
	Label    string `json:"label"`
	Requests int64  `json:"requests"`
	Blocked  int64  `json:"blocked"`
}

// Snapshot returns the 48 hourly buckets as chart points, oldest first.
func (hb *HourlyBucket) Snapshot() []TrafficPoint {
	hb.mu.Lock()
	defer hb.mu.Unlock()
	now := time.Now()
	out := make([]TrafficPoint, 48)
	for i := 0; i < 48; i++ {
		idx := (hb.currentIdx - 47 + i + 48) % 48
		t := now.Add(time.Duration(i-47) * time.Hour)
		out[i] = TrafficPoint{
			Label:    t.Format("15:00"),
			Requests: hb.buckets[idx].Requests,
			Blocked:  hb.buckets[idx].Blocked,
		}
	}
	return out
}
