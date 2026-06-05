package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	"github.com/sharvik/llm-firewall/gateway/internal/cache"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
)

// openAIError matches the OpenAI API error envelope.
type openAIError struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

// LLMProxy is the Zero-Trust reverse proxy.
//
// Request lifecycle — governance wraps caching, which wraps forwarding:
//  1. Payload firewall  — size cap, content-type, path safety; body read once
//  2. Rate limit        — sliding-window; fail-open on Redis error
//  3. ML Analyzer       — gRPC call to Python engine; fail-open on timeout
//     3a. BLOCK         → 403, audit, return
//     3b. MASK          → rebuild body with masked prompt, continue
//     3c. ALLOW         → continue; risk_score feeds Cedar
//  4. Cedar policy gate — ABAC with live risk_score from the ML engine
//  5. Cache lookup      — exact-match SHA-256; skip for streaming
//  6. Forward           — non-streaming: capture+store; streaming: passthrough
//  7. Audit             — async Kafka event
type LLMProxy struct {
	rp           *httputil.ReverseProxy
	cedar        *policy.CedarEngine
	producer     *events.EventProducer
	limiter      *ratelimit.RateLimiter
	cache        *cache.Cache
	mlClient     *analyzer.Client
	cfg          *config.Config
}

func NewLLMProxy(
	cfg *config.Config,
	cedar *policy.CedarEngine,
	producer *events.EventProducer,
	limiter *ratelimit.RateLimiter,
	c *cache.Cache,
	mlClient *analyzer.Client,
) (*LLMProxy, error) {
	target, err := url.Parse(cfg.TargetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid target URL %q: %w", cfg.TargetURL, err)
	}

	p := &LLMProxy{
		cedar:    cedar,
		producer: producer,
		limiter:  limiter,
		cache:    c,
		mlClient: mlClient,
		cfg:      cfg,
	}

	rp := httputil.NewSingleHostReverseProxy(target)
	rp.FlushInterval = -1 // required for SSE streaming

	baseDirector := rp.Director
	rp.Director = func(req *http.Request) {
		baseDirector(req)
		req.Host = target.Host
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	rp.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Server")
		resp.Header.Del("X-Powered-By")
		return nil
	}

	rp.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		logger.Get().Error("upstream error",
			slog.String("error", err.Error()),
			slog.String("request_id", chimiddleware.GetReqID(req.Context())),
		)
		p.writeError(w, http.StatusBadGateway, "upstream_error", "The upstream LLM provider is unavailable")
	}

	p.rp = rp
	return p, nil
}

func (p *LLMProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	reqID := chimiddleware.GetReqID(r.Context())
	log := logger.Get().With(slog.String("request_id", reqID))

	// --- Stage 1: Payload Firewall ---
	// Reads r.Body exactly once, restores it, returns raw bytes.
	body, err := p.inspectPayload(w, r)
	if err != nil {
		log.Warn("payload rejected", slog.String("reason", err.Error()))
		return
	}

	isStream := cache.IsStreaming(body)
	// TODO(phase-4): extract real tenant from a verified JWT / API-key lookup.
	tenantID := "tenant_123"
	cacheKey := p.cache.Key(tenantID, r.URL.Path, body)

	// Record every inbound request.
	metrics.Global.TotalRequests.Add(1)
	metrics.HourlyTraffic.Record(false) // update blocked flag later on block

	// --- Stage 2: Rate Limiting ---
	rl, rlErr := p.limiter.Allow(r.Context(), tenantID)
	if rlErr == nil {
		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", rl.Limit))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", rl.Remaining))
	}
	if rlErr == nil && !rl.Allowed {
		log.Warn("rate limit exceeded",
			slog.String("tenant", tenantID),
			slog.Int64("current", rl.Current),
			slog.Int64("limit", rl.Limit),
		)
		metrics.Global.RateLimited.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		metrics.Events.Push(metrics.Event{
			RequestID: reqID, TenantID: tenantID, Action: "RATE_LIMITED",
			RiskScore: 0, Path: r.URL.Path, Timestamp: time.Now().UTC(),
			Reason: "Rate limit exceeded",
		})
		p.writeError(w, http.StatusTooManyRequests, "rate_limit_exceeded",
			fmt.Sprintf("Rate limit of %d requests per minute exceeded.", rl.Limit))
		p.emitAudit(reqID, tenantID, "RATE_LIMITED", 0, http.StatusTooManyRequests, time.Since(start).Milliseconds())
		return
	}

	// --- Stage 3: ML Analyzer (gRPC) ---
	// The analyzer call comes BEFORE the cache lookup so a cached hit never
	// lets a poisoned prompt skip injection detection.
	analysis := p.mlClient.Analyze(r.Context(), reqID, tenantID, string(body))

	switch analysis.Action {
	case analyzer.ActionBlock:
		log.Warn("ML engine BLOCK",
			slog.String("reason", analysis.Reason),
			slog.Float64("risk_score", float64(analysis.RiskScore)),
		)
		metrics.Global.MLBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		metrics.Events.Push(metrics.Event{
			RequestID: reqID, TenantID: tenantID, Action: "ML_BLOCKED",
			RiskScore: float64(analysis.RiskScore), Path: r.URL.Path,
			Timestamp: time.Now().UTC(), Reason: analysis.Reason,
		})
		w.Header().Set("X-Titan-Decision", "BLOCK")
		p.writeError(w, http.StatusForbidden, "policy_violation", analysis.Reason)
		p.emitAudit(reqID, tenantID, "ML_BLOCKED", float64(analysis.RiskScore), http.StatusForbidden, time.Since(start).Milliseconds())
		return

	case analyzer.ActionMask:
		log.Info("ML engine MASK — PII redacted, forwarding sanitised body",
			slog.Float64("risk_score", float64(analysis.RiskScore)),
		)
		metrics.Global.PIIMasked.Add(1)
		metrics.Events.Push(metrics.Event{
			RequestID: reqID, TenantID: tenantID, Action: "PII_MASKED",
			RiskScore: float64(analysis.RiskScore), Path: r.URL.Path,
			Timestamp: time.Now().UTC(), Reason: analysis.Reason,
		})
		w.Header().Set("X-Titan-PII-Masked", "true")
		// Rebuild r.Body with the masked payload so the upstream receives
		// sanitised content. Re-derive the cache key off masked body too,
		// so different PII variants with the same structure share one entry.
		maskedBytes := []byte(analysis.MaskedPrompt)
		r.Body = io.NopCloser(bytes.NewReader(maskedBytes))
		r.ContentLength = int64(len(maskedBytes))
		body = maskedBytes
		cacheKey = p.cache.Key(tenantID, r.URL.Path, body)
	}

	// --- Stage 4: Cedar Policy Gate (fed with live ML risk score) ---
	contextData := map[string]interface{}{
		"risk_score": float64(analysis.RiskScore),
		"region":     "US",
	}
	allowed, _ := p.cedar.Evaluate(r.Context(), tenantID, "InvokeLLM", "OpenAI_GPT4", contextData)
	if !allowed {
		metrics.Global.CedarBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		metrics.Events.Push(metrics.Event{
			RequestID: reqID, TenantID: tenantID, Action: "CEDAR_BLOCKED",
			RiskScore: float64(analysis.RiskScore), Path: r.URL.Path,
			Timestamp: time.Now().UTC(), Reason: "Cedar ABAC policy denied",
		})
		p.writeError(w, http.StatusForbidden, "policy_violation", "Request blocked by security policy")
		p.emitAudit(reqID, tenantID, "CEDAR_BLOCKED", float64(analysis.RiskScore), http.StatusForbidden, time.Since(start).Milliseconds())
		return
	}

	// --- Stage 5: Cache Lookup ---
	if !isStream {
		if entry, hit, _ := p.cache.Get(r.Context(), cacheKey); hit {
			log.Info("cache HIT")
			metrics.Global.CacheHits.Add(1)
			metrics.Latency.Record(time.Since(start).Milliseconds())
			metrics.Events.Push(metrics.Event{
				RequestID: reqID, TenantID: tenantID, Action: "CACHE_HIT",
				RiskScore: float64(analysis.RiskScore), Path: r.URL.Path,
				Timestamp: time.Now().UTC(), LatencyMs: time.Since(start).Milliseconds(),
			})
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			for k, v := range entry.Headers {
				w.Header().Set(k, v)
			}
			w.WriteHeader(entry.StatusCode)
			w.Write(entry.Body) //nolint:errcheck
			p.emitAudit(reqID, tenantID, "CACHE_HIT", float64(analysis.RiskScore), entry.StatusCode, time.Since(start).Milliseconds())
			return
		}
		metrics.Global.CacheMisses.Add(1)
		w.Header().Set("X-Cache", "MISS")
	}

	// --- Stage 6: Forward ---
	if isStream {
		p.rp.ServeHTTP(w, r)
	} else {
		rc := newResponseCapture(w)
		p.rp.ServeHTTP(rc, r)

		if rc.statusCode == http.StatusOK && rc.body.Len() > 0 {
			p.cache.Set(r.Context(), cacheKey, rc.statusCode,
				map[string]string{"Content-Type": rc.Header().Get("Content-Type")},
				rc.body.Bytes(),
			)
		}
	}

	latencyMs := time.Since(start).Milliseconds()
	metrics.Global.AllowedRequests.Add(1)
	metrics.Latency.Record(latencyMs)
	metrics.Events.Push(metrics.Event{
		RequestID: reqID, TenantID: tenantID, Action: "ALLOWED",
		RiskScore: float64(analysis.RiskScore), Path: r.URL.Path,
		Timestamp: time.Now().UTC(), LatencyMs: latencyMs,
	})
	p.emitAudit(reqID, tenantID, "ALLOWED", float64(analysis.RiskScore), http.StatusOK, latencyMs)
}

// inspectPayload is the Suricata-layer. It reads r.Body exactly once,
// enforces structural invariants, restores r.Body, and returns the bytes.
func (p *LLMProxy) inspectPayload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if strings.Contains(r.URL.Path, "..") {
		p.writeError(w, http.StatusBadRequest, "invalid_request_error", "Path traversal detected")
		return nil, fmt.Errorf("path traversal in %q", r.URL.Path)
	}

	if strings.HasPrefix(r.URL.Path, "/v1/") && r.ContentLength != 0 {
		ct := r.Header.Get("Content-Type")
		if !strings.HasPrefix(ct, "application/json") {
			p.writeError(w, http.StatusUnsupportedMediaType, "invalid_request_error",
				"Content-Type must be application/json for /v1/ endpoints")
			return nil, fmt.Errorf("invalid content-type %q on %s", ct, r.URL.Path)
		}
	}

	var body []byte
	if r.Body != nil && r.Body != http.NoBody {
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			p.writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error",
				fmt.Sprintf("Request body exceeds the %d-byte limit", p.cfg.MaxRequestBodyBytes))
			return nil, fmt.Errorf("body read error (likely oversized): %w", err)
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
	}

	return body, nil
}

func (p *LLMProxy) writeError(w http.ResponseWriter, status int, errType, message string) {
	var body openAIError
	body.Error.Message = message
	body.Error.Type = errType
	body.Error.Code = status

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body) //nolint:errcheck
}

func (p *LLMProxy) emitAudit(reqID, tenantID, action string, risk float64, statusCode int, latencyMs int64) {
	if p.producer == nil {
		return
	}
	event := events.AuditEvent{
		EventID:    uuid.New().String(),
		RequestID:  reqID,
		TenantID:   tenantID,
		Action:     action,
		RiskScore:  risk,
		Provider:   "Groq",
		Model:      "llama3-8b",
		Prompt:     "[REDACTED]",
		StatusCode: statusCode,
		LatencyMs:  latencyMs,
		Timestamp:  time.Now().UTC(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	p.producer.EmitAudit(ctx, event)
}

// responseCapture mirrors response bytes for caching while simultaneously
// writing them to the client. Only used for non-streaming responses.
type responseCapture struct {
	http.ResponseWriter
	body       bytes.Buffer
	statusCode int
}

func newResponseCapture(w http.ResponseWriter) *responseCapture {
	return &responseCapture{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rc *responseCapture) WriteHeader(code int) {
	rc.statusCode = code
	rc.ResponseWriter.WriteHeader(code)
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	rc.body.Write(b) //nolint:errcheck
	return rc.ResponseWriter.Write(b)
}

func (rc *responseCapture) Flush() {
	if f, ok := rc.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
