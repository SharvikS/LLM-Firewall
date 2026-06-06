package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	mw "github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// reqBodyKey is the context key used to carry the raw request body through
// the proxy pipeline so the failover handler can replay it to the backup provider.
type reqBodyKey struct{}

// errUpstreamUnavailable is returned from ModifyResponse when the primary
// upstream sends a 5xx that warrants a failover attempt.
var errUpstreamUnavailable = errors.New("upstream returned service unavailable")

type openAIError struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

// LLMProxy is the Zero-Trust reverse proxy.
//
// Request lifecycle:
//  1. Payload firewall  — size, content-type, path traversal; body read once
//  2. Auth context      — tenantID + apiKeyID from APIKeyAuth middleware (fail-closed)
//  3. Rate limit        — per-tenant sliding-window (RPM from tenant config)
//  4. ML Analyzer       — gRPC; fail-open on timeout
//  5. Policy gate       — DB-backed ABAC; DENY wins
//  6. Cache lookup      — exact-match SHA-256; skip streaming
//  7. Forward           — streaming or capture+cache
//  8. Audit             — async Kafka + DB enqueue
type LLMProxy struct {
	rp         *httputil.ReverseProxy
	fallbackRP *httputil.ReverseProxy // nil if no fallback configured
	policy     *policy.Engine
	producer   *events.EventProducer
	limiter    *ratelimit.RateLimiter
	cache      *cache.Cache
	mlClient   *analyzer.Client
	st         *store.Store
	cfg        *config.Config
}

func NewLLMProxy(
	cfg *config.Config,
	policyEngine *policy.Engine,
	producer *events.EventProducer,
	limiter *ratelimit.RateLimiter,
	c *cache.Cache,
	mlClient *analyzer.Client,
	st *store.Store,
) (*LLMProxy, error) {
	target, err := url.Parse(cfg.TargetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid target URL %q: %w", cfg.TargetURL, err)
	}

	p := &LLMProxy{
		policy:   policyEngine,
		producer: producer,
		limiter:  limiter,
		cache:    c,
		mlClient: mlClient,
		st:       st,
		cfg:      cfg,
	}

	// Build optional fallback reverse proxy first so ErrorHandler can close over it.
	if cfg.FallbackTargetURL != "" {
		fb, err := url.Parse(cfg.FallbackTargetURL)
		if err != nil {
			return nil, fmt.Errorf("invalid fallback target URL %q: %w", cfg.FallbackTargetURL, err)
		}
		fbRp := httputil.NewSingleHostReverseProxy(fb)
		fbRp.FlushInterval = -1
		fbBase := fbRp.Director
		fbAPIKey := cfg.FallbackAPIKey
		fbRp.Director = func(req *http.Request) {
			fbBase(req)
			req.Host = fb.Host
			req.Header.Set("Authorization", "Bearer "+fbAPIKey)
		}
		fbRp.ModifyResponse = func(resp *http.Response) error {
			resp.Header.Del("Server")
			resp.Header.Del("X-Powered-By")
			return nil
		}
		fbRp.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
			logger.Get().Error("fallback upstream error",
				slog.String("error", err.Error()),
				slog.String("request_id", chimiddleware.GetReqID(req.Context())),
			)
			p.writeError(w, http.StatusBadGateway, "upstream_error", "All upstream LLM providers unavailable")
		}
		p.fallbackRP = fbRp
		logger.Get().Info("provider failover enabled", slog.String("fallback", cfg.FallbackTargetURL))
	}

	rp := httputil.NewSingleHostReverseProxy(target)
	rp.FlushInterval = -1

	base := rp.Director
	rp.Director = func(req *http.Request) {
		base(req)
		req.Host = target.Host
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		// Trigger failover on retriable server errors when a fallback is configured.
		if p.fallbackRP != nil {
			switch resp.StatusCode {
			case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
				resp.Body.Close()
				return errUpstreamUnavailable
			}
		}
		resp.Header.Del("Server")
		resp.Header.Del("X-Powered-By")
		return nil
	}
	rp.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		log := logger.Get().With(slog.String("request_id", chimiddleware.GetReqID(req.Context())))
		if p.fallbackRP != nil {
			log.Warn("primary upstream failed — failing over to backup provider",
				slog.String("error", err.Error()),
			)
			// Restore the request body from context so the fallback can read it.
			if rawBody, ok := req.Context().Value(reqBodyKey{}).([]byte); ok {
				req.Body = io.NopCloser(bytes.NewReader(rawBody))
				req.ContentLength = int64(len(rawBody))
			}
			p.fallbackRP.ServeHTTP(w, req)
			return
		}
		log.Error("upstream error", slog.String("error", err.Error()))
		p.writeError(w, http.StatusBadGateway, "upstream_error", "Upstream LLM provider unavailable")
	}
	p.rp = rp
	return p, nil
}

func (p *LLMProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start  := time.Now()
	reqID  := chimiddleware.GetReqID(r.Context())
	log    := logger.Get().With(slog.String("request_id", reqID))

	// Stage 1: Payload firewall — reads body once, restores it.
	body, err := p.inspectPayload(w, r)
	if err != nil {
		log.Warn("payload rejected", slog.String("reason", err.Error()))
		return
	}

	// Stage 2: Auth context — set by APIKeyAuth middleware (fail-closed).
	auth       := mw.GetAuthContext(r.Context())
	tenantID   := auth.TenantID
	tenantName := auth.TenantName
	apiKeyID   := auth.APIKeyID

	isStream := cache.IsStreaming(body)
	cacheKey := p.cache.Key(tenantID.String(), r.URL.Path, body)

	metrics.Global.TotalRequests.Add(1)
	metrics.HourlyTraffic.Record(false)

	// Store body in context so the failover handler can replay it if the
	// primary upstream fails after the body has been consumed.
	r = r.WithContext(context.WithValue(r.Context(), reqBodyKey{}, body))

	// Stage 3: Rate limiting — RPM (sliding window) then TPM (tumbling bucket).
	rl, rlErr := p.limiter.Allow(r.Context(), tenantID.String())
	if rlErr == nil {
		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", rl.Limit))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", rl.Remaining))
	}
	if rlErr == nil && !rl.Allowed {
		log.Warn("rate limit exceeded (RPM)",
			slog.String("tenant", tenantName),
			slog.Int64("current", rl.Current),
			slog.Int64("limit", rl.Limit),
		)
		metrics.Global.RateLimited.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		p.pushEvent(reqID, tenantName, "RATE_LIMITED", 0, r.URL.Path, "RPM rate limit exceeded")
		p.writeError(w, http.StatusTooManyRequests, "rate_limit_exceeded",
			fmt.Sprintf("Rate limit of %d rpm exceeded. Retry later.", rl.Limit))
		p.enqueueAudit(reqID, tenantID, apiKeyID, "RATE_LIMITED", 0, r.URL.Path,
			http.StatusTooManyRequests, time.Since(start).Milliseconds(), "RPM rate limit exceeded")
		p.emitKafka(reqID, tenantName, "RATE_LIMITED", 0, http.StatusTooManyRequests, time.Since(start).Milliseconds())
		return
	}

	// TPM check (skipped when tpmLimit == 0 or cfg.RateLimitTPM == 0).
	if p.cfg.RateLimitTPM > 0 {
		tokenCount := estimateTokens(body)
		tpm, tpmErr := p.limiter.AllowTokens(r.Context(), tenantID.String(), tokenCount)
		if tpmErr == nil && !tpm.Allowed {
			log.Warn("token rate limit exceeded (TPM)",
				slog.String("tenant", tenantName),
				slog.Int64("tokens_this_request", tokenCount),
				slog.Int64("current_tpm", tpm.Current),
				slog.Int64("limit_tpm", tpm.Limit),
			)
			metrics.Global.RateLimited.Add(1)
			metrics.Global.BlockedRequests.Add(1)
			metrics.HourlyTraffic.Record(true)
			p.pushEvent(reqID, tenantName, "RATE_LIMITED", 0, r.URL.Path, "TPM token limit exceeded")
			p.writeError(w, http.StatusTooManyRequests, "rate_limit_exceeded",
				fmt.Sprintf("Token limit of %d tokens/min exceeded. Retry later.", tpm.Limit))
			p.enqueueAudit(reqID, tenantID, apiKeyID, "RATE_LIMITED", 0, r.URL.Path,
				http.StatusTooManyRequests, time.Since(start).Milliseconds(), "TPM token limit exceeded")
			p.emitKafka(reqID, tenantName, "RATE_LIMITED", 0, http.StatusTooManyRequests, time.Since(start).Milliseconds())
			return
		}
		if tpmErr == nil {
			w.Header().Set("X-RateLimit-Tokens-Remaining", fmt.Sprintf("%d", tpm.Remaining))
		}
	}

	// Stage 4: ML Analyzer.
	analysis := p.mlClient.Analyze(r.Context(), reqID, tenantName, string(body))

	switch analysis.Action {
	case analyzer.ActionBlock:
		log.Warn("ML BLOCK",
			slog.String("reason", analysis.Reason),
			slog.Float64("risk_score", float64(analysis.RiskScore)),
		)
		metrics.Global.MLBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		p.pushEvent(reqID, tenantName, "ML_BLOCKED", float64(analysis.RiskScore), r.URL.Path, analysis.Reason)
		w.Header().Set("X-Titan-Decision", "BLOCK")
		p.writeError(w, http.StatusForbidden, "policy_violation", analysis.Reason)
		p.enqueueAudit(reqID, tenantID, apiKeyID, "ML_BLOCKED", float64(analysis.RiskScore), r.URL.Path,
			http.StatusForbidden, time.Since(start).Milliseconds(), analysis.Reason)
		p.emitKafka(reqID, tenantName, "ML_BLOCKED", float64(analysis.RiskScore), http.StatusForbidden, time.Since(start).Milliseconds())
		return

	case analyzer.ActionMask:
		log.Info("ML MASK — PII redacted",
			slog.Float64("risk_score", float64(analysis.RiskScore)),
		)
		metrics.Global.PIIMasked.Add(1)
		p.pushEvent(reqID, tenantName, "PII_MASKED", float64(analysis.RiskScore), r.URL.Path, analysis.Reason)
		w.Header().Set("X-Titan-PII-Masked", "true")
		masked := []byte(analysis.MaskedPrompt)
		r.Body = io.NopCloser(bytes.NewReader(masked))
		r.ContentLength = int64(len(masked))
		body = masked
		cacheKey = p.cache.Key(tenantID.String(), r.URL.Path, body)
	}

	// Stage 5: Policy gate.
	ctxData := map[string]interface{}{
		"risk_score": float64(analysis.RiskScore),
		"region":     "US",
	}
	allowed, reason := p.policy.Evaluate(r.Context(), tenantID, "InvokeLLM", "OpenAI", ctxData)
	if !allowed {
		metrics.Global.CedarBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		p.pushEvent(reqID, tenantName, "CEDAR_BLOCKED", float64(analysis.RiskScore), r.URL.Path, reason)
		p.writeError(w, http.StatusForbidden, "policy_violation", reason)
		p.enqueueAudit(reqID, tenantID, apiKeyID, "CEDAR_BLOCKED", float64(analysis.RiskScore), r.URL.Path,
			http.StatusForbidden, time.Since(start).Milliseconds(), reason)
		p.emitKafka(reqID, tenantName, "CEDAR_BLOCKED", float64(analysis.RiskScore), http.StatusForbidden, time.Since(start).Milliseconds())
		return
	}

	// Stage 6: Cache lookup.
	if !isStream {
		if entry, hit, _ := p.cache.Get(r.Context(), cacheKey); hit {
			log.Info("cache HIT")
			metrics.Global.CacheHits.Add(1)
			metrics.Latency.Record(time.Since(start).Milliseconds())
			p.pushEvent(reqID, tenantName, "CACHE_HIT", float64(analysis.RiskScore), r.URL.Path, "")
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			for k, v := range entry.Headers {
				w.Header().Set(k, v)
			}
			w.WriteHeader(entry.StatusCode)
			w.Write(entry.Body) //nolint:errcheck
			p.enqueueAudit(reqID, tenantID, apiKeyID, "CACHE_HIT", float64(analysis.RiskScore), r.URL.Path,
				entry.StatusCode, time.Since(start).Milliseconds(), "")
			p.emitKafka(reqID, tenantName, "CACHE_HIT", float64(analysis.RiskScore), entry.StatusCode, time.Since(start).Milliseconds())
			return
		}
		metrics.Global.CacheMisses.Add(1)
		w.Header().Set("X-Cache", "MISS")
	}

	// Stage 7: Forward.
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

	// Stage 8: Audit.
	latencyMs := time.Since(start).Milliseconds()
	metrics.Global.AllowedRequests.Add(1)
	metrics.Latency.Record(latencyMs)
	p.pushEvent(reqID, tenantName, "ALLOWED", float64(analysis.RiskScore), r.URL.Path, "")
	p.enqueueAudit(reqID, tenantID, apiKeyID, "ALLOWED", float64(analysis.RiskScore), r.URL.Path,
		http.StatusOK, latencyMs, "")
	p.emitKafka(reqID, tenantName, "ALLOWED", float64(analysis.RiskScore), http.StatusOK, latencyMs)
}

// inspectPayload reads body once, enforces structural invariants, restores r.Body.
func (p *LLMProxy) inspectPayload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if strings.Contains(r.URL.Path, "..") {
		p.writeError(w, http.StatusBadRequest, "invalid_request_error", "Path traversal detected")
		return nil, fmt.Errorf("path traversal in %q", r.URL.Path)
	}
	if strings.HasPrefix(r.URL.Path, "/v1/") && r.ContentLength != 0 {
		ct := r.Header.Get("Content-Type")
		if !strings.HasPrefix(ct, "application/json") {
			p.writeError(w, http.StatusUnsupportedMediaType, "invalid_request_error",
				"Content-Type must be application/json")
			return nil, fmt.Errorf("invalid content-type %q", ct)
		}
	}
	var body []byte
	if r.Body != nil && r.Body != http.NoBody {
		var err error
		body, err = io.ReadAll(r.Body)
		if err != nil {
			p.writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error",
				fmt.Sprintf("Request body exceeds %d-byte limit", p.cfg.MaxRequestBodyBytes))
			return nil, fmt.Errorf("body read: %w", err)
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

func (p *LLMProxy) pushEvent(reqID, tenantName, action string, risk float64, path, reason string) {
	metrics.Events.Push(metrics.Event{
		RequestID: reqID, TenantID: tenantName, Action: action,
		RiskScore: risk, Path: path, Timestamp: time.Now().UTC(), Reason: reason,
	})
}

func (p *LLMProxy) enqueueAudit(reqID string, tenantID, apiKeyID uuid.UUID, action string,
	risk float64, path string, status int, latencyMs int64, reason string) {
	if p.st == nil {
		return
	}
	tid := &tenantID
	kid := &apiKeyID
	if tenantID == uuid.Nil {
		tid = nil
	}
	if apiKeyID == uuid.Nil {
		kid = nil
	}
	p.st.EnqueueAudit(store.AuditRow{
		RequestID:  reqID,
		TenantID:   tid,
		APIKeyID:   kid,
		Action:     action,
		RiskScore:  risk,
		Path:       path,
		LatencyMs:  latencyMs,
		StatusCode: status,
		Reason:     reason,
	})
}

func (p *LLMProxy) emitKafka(reqID, tenantID, action string, risk float64, statusCode int, latencyMs int64) {
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

// estimateTokens approximates the number of tokens in an OpenAI-format request
// body using the standard heuristic of 4 characters ≈ 1 token. It also adds
// max_tokens (output budget) if the caller specified it, making the estimate
// conservative enough for cost-aware TPM enforcement.
func estimateTokens(body []byte) int64 {
	if len(body) == 0 {
		return 1
	}
	var req struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
		MaxTokens int `json:"max_tokens"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return int64(len(body)/4) + 1
	}
	var chars int
	for _, m := range req.Messages {
		chars += len(m.Content)
	}
	estimate := int64(chars/4) + 1
	if req.MaxTokens > 0 {
		estimate += int64(req.MaxTokens)
	}
	return estimate
}

// responseCapture captures the response body for caching while simultaneously
// writing it to the client. Non-streaming only.
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
