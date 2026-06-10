// Package batch implements the asynchronous bulk-prompt API (/v1/batch).
//
// Each item in a batch is run through the same governance gate as the live
// proxy — the ML analyzer decides ALLOW / MASK / BLOCK per item — before it is
// forwarded to the upstream LLM. A batch that bypassed the analyzer would
// contradict the product premise, so governance is mandatory here.
//
// Job state is persisted in Redis (key `titan:batch:<id>`, 24h TTL) so any
// gateway replica can serve a status query. When Redis is unavailable the
// manager keeps state in-process so local/dev runs still work; that fallback is
// single-replica only and is logged at startup.
package batch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

const (
	// MaxItems caps a single batch so one request can't enqueue unbounded work.
	MaxItems = 100
	jobTTL   = 24 * time.Hour
	keyspace = "titan:batch:"
)

// Status values for a job and its items.
const (
	StatusQueued     = "queued"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	ItemAllowed      = "allowed"
	ItemMasked       = "masked"
	ItemBlocked      = "blocked"
	ItemError        = "error"
)

// Item is the per-prompt result within a batch.
type Item struct {
	Index     int             `json:"index"`
	Status    string          `json:"status"`
	RiskScore float32         `json:"risk_score"`
	Reason    string          `json:"reason,omitempty"`
	Response  json.RawMessage `json:"response,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// Job is the durable record of a submitted batch.
type Job struct {
	ID          string     `json:"id"`
	TenantID    string     `json:"tenant_id"`
	Status      string     `json:"status"`
	Total       int        `json:"total"`
	Completed   int        `json:"completed"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Items       []Item     `json:"items"`
}

// Manager owns batch submission, processing and persistence.
type Manager struct {
	rdb            *redis.Client // nil → in-memory fallback
	ml             *analyzer.Client
	httpc          *http.Client
	upstreamURL    string // e.g. https://api.groq.com/openai/v1/chat/completions
	upstreamKey    string
	maxConcurrency int

	mu  sync.Mutex
	mem map[string]*Job // fallback store when Redis is down
}

// NewManager wires the batch manager. targetURL is the gateway's upstream base
// (cfg.TargetURL); the OpenAI-compatible chat path is appended to it.
func NewManager(rdb *redis.Client, ml *analyzer.Client, targetURL, upstreamKey string) *Manager {
	base := strings.TrimRight(targetURL, "/")
	if rdb == nil {
		logger.Get().Warn("batch: Redis unavailable — job state is in-memory (single replica only)")
	}
	return &Manager{
		rdb:            rdb,
		ml:             ml,
		httpc:          &http.Client{Timeout: 60 * time.Second},
		upstreamURL:    base + "/v1/chat/completions",
		upstreamKey:    upstreamKey,
		maxConcurrency: 4,
		mem:            make(map[string]*Job),
	}
}

// Submit validates and enqueues a batch, returning the created job. Processing
// runs in the background; poll Get for completion.
func (m *Manager) Submit(ctx context.Context, tenantID string, items []json.RawMessage) (*Job, error) {
	if len(items) == 0 {
		return nil, fmt.Errorf("batch must contain at least one request")
	}
	if len(items) > MaxItems {
		return nil, fmt.Errorf("batch exceeds the %d-item limit", MaxItems)
	}

	job := &Job{
		ID:        uuid.NewString(),
		TenantID:  tenantID,
		Status:    StatusQueued,
		Total:     len(items),
		CreatedAt: time.Now().UTC(),
		Items:     make([]Item, len(items)),
	}
	for i := range job.Items {
		job.Items[i] = Item{Index: i, Status: StatusQueued}
	}
	m.persist(ctx, job)

	// Detach from the request context so processing survives the HTTP response.
	go m.process(context.Background(), job, items)
	return job, nil
}

// Get loads a job by ID. Returns nil if not found.
func (m *Manager) Get(ctx context.Context, id string) (*Job, error) {
	if m.rdb != nil {
		raw, err := m.rdb.Get(ctx, keyspace+id).Bytes()
		if err == redis.Nil {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		var job Job
		if err := json.Unmarshal(raw, &job); err != nil {
			return nil, err
		}
		return &job, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, ok := m.mem[id]; ok {
		clone := *job
		return &clone, nil
	}
	return nil, nil
}

func (m *Manager) process(ctx context.Context, job *Job, items []json.RawMessage) {
	job.Status = StatusProcessing
	m.persist(ctx, job)

	var (
		wg  sync.WaitGroup
		mu  sync.Mutex // guards job mutation + persist
		sem = make(chan struct{}, m.maxConcurrency)
	)

	for i, raw := range items {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, body json.RawMessage) {
			defer wg.Done()
			defer func() { <-sem }()

			result := m.processItem(ctx, job, idx, body)

			mu.Lock()
			job.Items[idx] = result
			job.Completed++
			m.persist(ctx, job)
			mu.Unlock()
		}(i, raw)
	}
	wg.Wait()

	now := time.Now().UTC()
	job.Status = StatusCompleted
	job.CompletedAt = &now
	m.persist(ctx, job)
	logger.Get().Info("batch completed",
		slog.String("job_id", job.ID),
		slog.Int("total", job.Total))
}

// processItem runs one prompt through governance, then forwards to upstream.
func (m *Manager) processItem(ctx context.Context, job *Job, idx int, body json.RawMessage) Item {
	item := Item{Index: idx}
	reqID := fmt.Sprintf("%s-%d", job.ID, idx)

	analysis := m.ml.Analyze(ctx, reqID, job.TenantID, string(body))
	item.RiskScore = analysis.RiskScore

	forward := body
	switch analysis.Action {
	case analyzer.ActionBlock:
		item.Status = ItemBlocked
		item.Reason = analysis.Reason
		return item
	case analyzer.ActionMask:
		item.Status = ItemMasked
		item.Reason = analysis.Reason
		if analysis.MaskedPrompt != "" {
			forward = json.RawMessage(analysis.MaskedPrompt)
		}
	default:
		item.Status = ItemAllowed
	}

	resp, err := m.callUpstream(ctx, forward)
	if err != nil {
		item.Status = ItemError
		item.Error = err.Error()
		return item
	}
	item.Response = resp
	return item
}

func (m *Manager) callUpstream(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.upstreamURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.upstreamKey)

	resp, err := m.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20)) // 5 MB cap
	if err != nil {
		return nil, fmt.Errorf("reading upstream response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	if !json.Valid(raw) {
		// Preserve the payload as a JSON string so the job stays valid JSON.
		return json.Marshal(string(raw))
	}
	return json.RawMessage(raw), nil
}

func (m *Manager) persist(ctx context.Context, job *Job) {
	if m.rdb != nil {
		raw, err := json.Marshal(job)
		if err != nil {
			logger.Get().Error("batch: marshal job failed", slog.String("error", err.Error()))
			return
		}
		if err := m.rdb.Set(ctx, keyspace+job.ID, raw, jobTTL).Err(); err != nil {
			logger.Get().Warn("batch: redis persist failed", slog.String("error", err.Error()))
		}
		return
	}
	m.mu.Lock()
	clone := *job
	clone.Items = append([]Item(nil), job.Items...)
	m.mem[job.ID] = &clone
	m.mu.Unlock()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
