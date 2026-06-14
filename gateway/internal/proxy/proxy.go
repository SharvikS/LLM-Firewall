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
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	"github.com/sharvik/llm-firewall/gateway/internal/billing"
	"github.com/sharvik/llm-firewall/gateway/internal/cache"
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	mw "github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/plugins"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
	"github.com/sharvik/llm-firewall/gateway/internal/settings"
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
	rp            *httputil.ReverseProxy
	fallbackRP    *httputil.ReverseProxy // nil if no fallback configured
	policy        *policy.Engine
	producer      *events.EventProducer
	limiter       *ratelimit.RateLimiter
	cache         *cache.Cache
	semanticCache *cache.SemanticCache // nil if Qdrant not configured
	mlClient      *analyzer.Client
	st            *store.Store
	cfg           *config.Config
	settings      *settings.Manager // live runtime knobs (rate limits, timeouts, gates)
	meter         *billing.Meter    // per-tenant usage metering + quota (nil-safe)
	provider      string            // upstream provider label derived from TargetURL host
	plugins       *plugins.Runtime  // WASM custom-rule stage; nil-safe when disabled
}

// providerFromHost maps an upstream host to a human-readable provider label for
// audit events (e.g. "api.groq.com" → "Groq"). Falls back to the bare host.
func providerFromHost(host string) string {
	h := strings.ToLower(host)
	switch {
	case strings.Contains(h, "groq"):
		return "Groq"
	case strings.Contains(h, "openai"):
		return "OpenAI"
	case strings.Contains(h, "anthropic"):
		return "Anthropic"
	case strings.Contains(h, "googleapis") || strings.Contains(h, "generativelanguage"):
		return "Google"
	case h == "":
		return "unknown"
	default:
		return host
	}
}

// parseModel extracts the "model" field from an OpenAI-format request body for
// audit attribution. Returns "unknown" when absent or unparseable so analytics
// never attribute traffic to a hardcoded model.
func parseModel(body []byte) string {
	if len(body) == 0 {
		return "unknown"
	}
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Model == "" {
		return "unknown"
	}
	return req.Model
}

func NewLLMProxy(
	cfg *config.Config,
	policyEngine *policy.Engine,
	producer *events.EventProducer,
	limiter *ratelimit.RateLimiter,
	c *cache.Cache,
	semanticCache *cache.SemanticCache,
	mlClient *analyzer.Client,
	st *store.Store,
	pluginRT *plugins.Runtime,
	settingsMgr *settings.Manager,
	meter *billing.Meter,
) (*LLMProxy, error) {
	target, err := url.Parse(cfg.TargetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid target URL %q: %w", cfg.TargetURL, err)
	}

	p := &LLMProxy{
		policy:        policyEngine,
		producer:      producer,
		limiter:       limiter,
		cache:         c,
		semanticCache: semanticCache,
		mlClient:      mlClient,
		st:            st,
		cfg:           cfg,
		settings:      settingsMgr,
		meter:         meter,
		provider:      providerFromHost(target.Host),
		plugins:       pluginRT,
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
			// Propagate the trace ID to the fallback upstream too.
			otel.GetTextMapPropagator().Inject(req.Context(), propagation.HeaderCarrier(req.Header))
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
	defaultTarget := target
	rp.Director = func(req *http.Request) {
		// Capture the incoming path before base() joins it to the default target.
		incomingPath := req.URL.Path
		base(req) // sets default User-Agent etc.

		// Resolve the live upstream: an API provider (Groq/OpenAI) or a local LLM
		// (Ollama/LM Studio/vLLM), switchable from the dashboard with no restart.
		up := defaultTarget
		key := cfg.APIKey
		if p.settings != nil {
			s := p.settings.Get()
			if s.UpstreamURL != "" {
				if u, err := url.Parse(s.UpstreamURL); err == nil && u.Host != "" {
					up = u
					key = s.UpstreamAPIKey
				}
			}
		}
		req.URL.Scheme = up.Scheme
		req.URL.Host = up.Host
		// Re-join the upstream's base path (e.g. "/openai" for Groq, "" for Ollama)
		// with the original request path so both provider shapes route correctly.
		req.URL.Path = singleJoiningSlash(up.Path, incomingPath)
		req.URL.RawPath = ""
		req.Host = up.Host

		// Keyless local servers (e.g. Ollama) need no auth — and we must not leak
		// the caller's gateway API key upstream, so drop it when no key is set.
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		} else {
			req.Header.Del("Authorization")
		}
		// W3C traceparent travels to the LLM upstream so one Jaeger trace
		// covers the full gateway → provider round trip. The propagator is
		// a no-op when tracing is disabled.
		otel.GetTextMapPropagator().Inject(req.Context(), propagation.HeaderCarrier(req.Header))
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		// Trigger failover on retriable server errors when a fallback is configured
		// and the live "Edge Routing" failover toggle is on.
		if p.fallbackRP != nil && p.settings.Get().FailoverEnabled {
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
		if p.fallbackRP != nil && p.settings.Get().FailoverEnabled {
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

// singleJoiningSlash joins two URL path segments with exactly one slash. Copied
// from net/http/httputil (unexported there) so the dynamic Director can re-join
// the active upstream's base path with the incoming request path.
func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	}
	return a + b
}

func (p *LLMProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	reqID := chimiddleware.GetReqID(r.Context())
	log := logger.Get().With(slog.String("request_id", reqID))

	// Stage 1: Payload firewall — reads body once, restores it.
	body, err := p.inspectPayload(w, r)
	if err != nil {
		log.Warn("payload rejected", slog.String("reason", err.Error()))
		return
	}

	// Stage 2: Auth context — set by APIKeyAuth middleware (fail-closed).
	auth := mw.GetAuthContext(r.Context())
	tenantID := auth.TenantID
	tenantName := auth.TenantName
	apiKeyID := auth.APIKeyID

	// Effective settings for this tenant: the global document with any per-tenant
	// override applied. Read once per request so a mid-request settings change
	// can't produce inconsistent decisions.
	set := p.settings.GetForTenant(tenantID.String())

	isStream := cache.IsStreaming(body)
	cacheKey := p.cache.Key(tenantID.String(), r.URL.Path, body)
	model := parseModel(body) // real requested model for audit attribution
	originalBody := body      // pre-mask copy: plugins inspect what the user actually sent

	// Resolve request region from Cloudflare or a custom header early so every
	// audit event carries it regardless of where in the pipeline the request exits.
	region := r.Header.Get("CF-IPCountry")
	if region == "" {
		region = r.Header.Get("X-Region")
	}
	if region == "" {
		region = "unknown"
	}

	metrics.Global.TotalRequests.Add(1)
	metrics.HourlyTraffic.Record(false)

	// Stage 3: Rate limiting — RPM (sliding window) then TPM (tumbling bucket).
	// Limits are per-tenant (from the effective settings), not a single global.
	rl, rlErr := p.limiter.AllowWithLimit(r.Context(), tenantID.String(), set.RateLimitRPM)
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
		p.emitKafka(reqID, tenantID, apiKeyID, "RATE_LIMITED", 0, r.URL.Path,
			http.StatusTooManyRequests, time.Since(start).Milliseconds(), "RPM rate limit exceeded", region, model)
		return
	}

	// TPM check (skipped when the tenant's effective TPM limit is 0).
	if set.RateLimitTPM > 0 {
		tokenCount := estimateTokens(body)
		tpm, tpmErr := p.limiter.AllowTokensWithLimit(r.Context(), tenantID.String(), tokenCount, set.RateLimitTPM)
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
			p.emitKafka(reqID, tenantID, apiKeyID, "RATE_LIMITED", 0, r.URL.Path,
				http.StatusTooManyRequests, time.Since(start).Milliseconds(), "TPM token limit exceeded", region, model)
			return
		}
		if tpmErr == nil {
			w.Header().Set("X-RateLimit-Tokens-Remaining", fmt.Sprintf("%d", tpm.Remaining))
		}
	}

	// Stage 3b: Monthly volume quota (plan entitlement). RPM/TPM cap burst; this
	// caps total monthly volume by the tenant's plan tier. Fail-open on Redis error.
	if over, usage := p.meter.OverQuota(r.Context(), tenantID.String(), auth.Tier, start); over {
		log.Warn("monthly quota exceeded",
			slog.String("tenant", tenantName),
			slog.String("tier", auth.Tier),
			slog.Int64("used", usage.Requests),
			slog.Int64("limit", usage.Limit),
		)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		w.Header().Set("X-Quota-Limit", fmt.Sprintf("%d", usage.Limit))
		w.Header().Set("X-Quota-Used", fmt.Sprintf("%d", usage.Requests))
		p.pushEvent(reqID, tenantName, "QUOTA_EXCEEDED", 0, r.URL.Path, "monthly plan quota exceeded")
		p.writeError(w, http.StatusTooManyRequests, "quota_exceeded",
			fmt.Sprintf("Monthly request quota of %d for the %q plan exceeded. Upgrade to continue.", usage.Limit, auth.Tier))
		p.emitKafka(reqID, tenantID, apiKeyID, "QUOTA_EXCEEDED", 0, r.URL.Path,
			http.StatusTooManyRequests, time.Since(start).Milliseconds(), "monthly quota exceeded", region, model)
		return
	}

	// Meter every admitted request exactly once on exit, with input-token volume
	// and the final block outcome. Background context so a client disconnect
	// can't drop the meter write. Rejected requests above are intentionally not
	// metered (they never consumed quota).
	billedTokens := estimateTokens(body)
	blockedOutcome := false
	defer func() {
		p.meter.Record(context.Background(), tenantID.String(), billedTokens, blockedOutcome, start)
	}()

	// Stage 4: ML Analyzer. The inline deadline is dashboard-tunable.
	analysis := p.mlClient.AnalyzeWithTimeout(r.Context(), reqID, tenantName, string(body),
		time.Duration(set.AnalyzerTimeoutMs)*time.Millisecond)

	switch analysis.Action {
	case analyzer.ActionBlock:
		log.Warn("ML BLOCK",
			slog.String("reason", analysis.Reason),
			slog.Float64("risk_score", float64(analysis.RiskScore)),
		)
		metrics.Global.MLBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		blockedOutcome = true // recorded by the deferred meter
		p.pushEvent(reqID, tenantName, "ML_BLOCKED", float64(analysis.RiskScore), r.URL.Path, analysis.Reason)
		w.Header().Set("X-Titan-Decision", "BLOCK")
		p.writeError(w, http.StatusForbidden, "policy_violation", analysis.Reason)
		p.emitKafka(reqID, tenantID, apiKeyID, "ML_BLOCKED", float64(analysis.RiskScore), r.URL.Path,
			http.StatusForbidden, time.Since(start).Milliseconds(), analysis.Reason, region, model)
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

	// Store the (potentially PII-masked) body for failover replay.
	// This must happen after the ML Analyzer so the fallback provider never
	// receives the original unredacted payload.
	r = r.WithContext(context.WithValue(r.Context(), reqBodyKey{}, body))

	// Stage 4b: WASM custom-rule plugins. Operator-supplied .wasm detectors run
	// on the (post-mask) prompt text; any block verdict denies the request.
	// Fail-open: a misbehaving plugin is skipped inside the runtime, never here.
	if p.plugins.Enabled() {
		// Scan the original prompt, not the PII-masked body — masking would hide
		// the very terms (names, codenames) a custom rule needs to see.
		for _, v := range p.plugins.Scan(r.Context(), string(originalBody)) {
			if v.Block {
				reason := "blocked by plugin " + v.Plugin
				if v.Reason != "" {
					reason = v.Reason + " (" + v.Plugin + ")"
				}
				log.Warn("PLUGIN BLOCK", slog.String("plugin", v.Plugin), slog.String("reason", v.Reason))
				metrics.Global.BlockedRequests.Add(1)
				metrics.HourlyTraffic.Record(true)
				p.pushEvent(reqID, tenantName, "PLUGIN_BLOCKED", v.Score, r.URL.Path, reason)
				w.Header().Set("X-Titan-Decision", "BLOCK")
				p.writeError(w, http.StatusForbidden, "policy_violation", reason)
				p.emitKafka(reqID, tenantID, apiKeyID, "PLUGIN_BLOCKED", v.Score, r.URL.Path,
					http.StatusForbidden, time.Since(start).Milliseconds(), reason, region, model)
				return
			}
		}
	}

	// Stage 5: Policy gate.
	ctxData := map[string]interface{}{
		"risk_score": float64(analysis.RiskScore),
		"region":     region,
	}
	allowed, reason := p.policy.Evaluate(r.Context(), tenantID, "InvokeLLM", "OpenAI", ctxData)
	if !allowed {
		metrics.Global.CedarBlocked.Add(1)
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
		p.pushEvent(reqID, tenantName, "CEDAR_BLOCKED", float64(analysis.RiskScore), r.URL.Path, reason)
		p.writeError(w, http.StatusForbidden, "policy_violation", reason)
		p.emitKafka(reqID, tenantID, apiKeyID, "CEDAR_BLOCKED", float64(analysis.RiskScore), r.URL.Path,
			http.StatusForbidden, time.Since(start).Milliseconds(), reason, region, model)
		return
	}

	// Stage 6: Cache lookup — exact match first, then semantic.
	if !isStream {
		riskF := float64(analysis.RiskScore)
		if entry, hit, _ := p.cache.Get(r.Context(), cacheKey); hit {
			log.Info("cache HIT (exact)")
			p.serveCachedEntry(w, r, entry, "HIT", reqID, tenantName, tenantID, apiKeyID, riskF, start, region, model)
			return
		}
		// Semantic cache: vector similarity search in Qdrant.
		if p.semanticCache != nil {
			if entry, hit := p.semanticCache.Get(r.Context(), body); hit {
				log.Info("cache HIT (semantic)")
				p.serveCachedEntry(w, r, entry, "SEMANTIC-HIT", reqID, tenantName, tenantID, apiKeyID, riskF, start, region, model)
				return
			}
		}
		metrics.Global.CacheMisses.Add(1)
		w.Header().Set("X-Cache", "MISS")
	}

	// Stage 7: Forward.
	outputMasked := false
	if isStream {
		if set.OutputScanEnabled {
			// Streamed (SSE) responses can't be buffered without destroying the
			// streaming UX, so high-confidence PII/secrets are masked inline as
			// the deltas flow through — cross-chunk safe via a carry buffer. The
			// X-Titan-Output-Masked header can't be set (headers already flushed),
			// so the outcome is reflected in the audit log after the stream ends.
			sm := newStreamMasker(w)
			p.rp.ServeHTTP(sm, r)
			if err := sm.Close(); err != nil {
				log.Warn("stream masker flush failed", slog.String("error", err.Error()))
			}
			if sm.masked {
				outputMasked = true
				metrics.Global.PIIMasked.Add(1)
				log.Info("output scan — streamed PII/secrets masked")
			}
		} else {
			p.rp.ServeHTTP(w, r)
		}
	} else if set.OutputScanEnabled {
		// Buffer the response (no tee), scan/mask the assistant text, then send.
		bw := newBufferingResponse(w)
		p.rp.ServeHTTP(bw, r)

		finalBody := bw.body.Bytes()
		scannable := bw.statusCode == http.StatusOK && !bw.overflowed &&
			bw.body.Len() > 0 && r.Context().Err() == nil

		if scannable {
			if rewritten, did := p.scanResponseBody(r.Context(), reqID, tenantName, finalBody); did {
				finalBody = rewritten
				outputMasked = true
				w.Header().Set("X-Titan-Output-Masked", "true")
				metrics.Global.PIIMasked.Add(1)
				log.Info("output scan — response PII/secrets masked")
			}
			// Cache the post-mask body so masked content is served on cache hits.
			ct := map[string]string{"Content-Type": bw.Header().Get("Content-Type")}
			p.cache.Set(r.Context(), cacheKey, bw.statusCode, ct, finalBody)
			if p.semanticCache != nil {
				p.semanticCache.Set(r.Context(), body, bw.statusCode, ct, finalBody)
			}
			bw.finalize(finalBody)
		} else {
			bw.finalize(nil) // not scannable — send the captured body verbatim
		}
	} else {
		rc := newResponseCapture(w)
		p.rp.ServeHTTP(rc, r)
		// Cache only when ALL conditions hold:
		//   1. Upstream returned 200 with a non-empty body.
		//   2. Buffer did not overflow maxCacheBodyBytes (OOM guard).
		//   3. Client context is still alive — a cancelled context means the
		//      client disconnected mid-response, leaving a partial buffer that
		//      would poison the cache with truncated JSON.
		if rc.statusCode == http.StatusOK &&
			rc.body.Len() > 0 &&
			!rc.overflowed &&
			r.Context().Err() == nil {
			ct := map[string]string{"Content-Type": rc.Header().Get("Content-Type")}
			p.cache.Set(r.Context(), cacheKey, rc.statusCode, ct, rc.body.Bytes())
			if p.semanticCache != nil {
				p.semanticCache.Set(r.Context(), body, rc.statusCode, ct, rc.body.Bytes())
			}
		}
	}

	// Stage 8: Audit.
	latencyMs := time.Since(start).Milliseconds()
	metrics.Global.AllowedRequests.Add(1)
	metrics.Latency.Record(latencyMs)
	auditAction := "ALLOWED"
	if outputMasked {
		auditAction = "OUTPUT_MASKED"
	}
	p.pushEvent(reqID, tenantName, auditAction, float64(analysis.RiskScore), r.URL.Path, "")
	// "Audit All Requests" (default on) writes clean ALLOWs to the durable audit
	// log. When disabled, only security-relevant outcomes (blocks, masks) persist.
	if set.AuditAllRequests || auditAction != "ALLOWED" {
		p.emitKafka(reqID, tenantID, apiKeyID, auditAction, float64(analysis.RiskScore), r.URL.Path,
			http.StatusOK, latencyMs, "", region, model)
	}
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
		// Wrap with MaxBytesReader before ReadAll so the read is aborted at the
		// size limit rather than after the full payload has been buffered.
		// The middleware applies the same limit, but enforcing it here makes
		// inspectPayload safe even when called outside the normal middleware chain.
		r.Body = http.MaxBytesReader(w, r.Body, p.cfg.MaxRequestBodyBytes)
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

// emitKafka is the single write path for audit events. It replaces the old
// enqueueAudit + emitKafka pair: the Kafka consumer owns the DB write, so the
// request path only needs to fire-and-forget to Kafka. tenantID and apiKeyID
// are the real UUIDs (not display names), fixing the prior tenantName bug.
func (p *LLMProxy) emitKafka(
	reqID string,
	tenantID, apiKeyID uuid.UUID,
	action string,
	risk float64,
	path string,
	statusCode int,
	latencyMs int64,
	reason, region, model string,
) {
	if p.producer == nil {
		return
	}
	apiKeyStr := ""
	if apiKeyID != uuid.Nil {
		apiKeyStr = apiKeyID.String()
	}
	if model == "" {
		model = "unknown"
	}
	event := events.AuditEvent{
		EventID:    uuid.New().String(),
		RequestID:  reqID,
		TenantID:   tenantID.String(),
		APIKeyID:   apiKeyStr,
		Action:     action,
		RiskScore:  risk,
		Provider:   p.provider,
		Model:      model,
		Prompt:     "[REDACTED]",
		StatusCode: statusCode,
		LatencyMs:  latencyMs,
		Path:       path,
		Reason:     reason,
		Region:     region,
		Timestamp:  time.Now().UTC(),
	}
	// Pass context.Background() so the async Kafka produce callback is not
	// aborted when this function returns.
	p.producer.EmitAudit(context.Background(), event)
}

// serveCachedEntry writes a cached response to the client and records metrics/audit.
// xCacheVal is the X-Cache header value (e.g. "HIT" or "SEMANTIC-HIT").
func (p *LLMProxy) serveCachedEntry(
	w http.ResponseWriter, r *http.Request,
	entry *cache.Entry, xCacheVal string,
	reqID, tenantName string, tenantID, apiKeyID uuid.UUID,
	riskScore float64,
	start time.Time,
	region, model string,
) {
	latencyMs := time.Since(start).Milliseconds()
	metrics.Global.CacheHits.Add(1)
	metrics.Latency.Record(latencyMs)
	p.pushEvent(reqID, tenantName, "CACHE_HIT", riskScore, r.URL.Path, xCacheVal)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", xCacheVal)
	for k, v := range entry.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(entry.StatusCode)
	w.Write(entry.Body) //nolint:errcheck
	p.emitKafka(reqID, tenantID, apiKeyID, "CACHE_HIT", riskScore, r.URL.Path,
		entry.StatusCode, latencyMs, xCacheVal, region, model)
}

// estimateTokens approximates the number of tokens in an OpenAI-format request
// body and adds max_tokens (output budget) when specified.
//
// Token counting uses two heuristics applied per rune:
//   - ASCII (< 128): ~4 chars per token (standard GPT heuristic).
//   - Non-ASCII (CJK, emoji, etc.): ~1 char per token — BPE tokenizers assign
//     far fewer bytes per token for high-density Unicode, so using the ASCII
//     heuristic would under-count and let an attacker slip under TPM limits.
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
	var estimate int64
	for _, m := range req.Messages {
		var ascii, nonASCII int64
		for _, r := range m.Content {
			if r < 128 {
				ascii++
			} else {
				nonASCII++
			}
		}
		estimate += ascii/4 + nonASCII
	}
	estimate++ // floor at 1
	if req.MaxTokens > 0 {
		estimate += int64(req.MaxTokens)
	}
	return estimate
}

// maxCacheBodyBytes is the maximum response size we will buffer for caching.
// Responses larger than this are still forwarded to the client but never
// stored — this prevents OOM kills from unexpectedly large LLM payloads.
const maxCacheBodyBytes = 5 * 1024 * 1024 // 5 MB

// responseCapture tees the upstream response to both the client and an
// internal buffer for caching.  Non-streaming only.
//
// Safety invariants:
//   - If the buffered response exceeds maxCacheBodyBytes the internal buffer
//     is discarded and overflowed is set — the response still reaches the
//     client but is never written to any cache.
//   - The caller must also check r.Context().Err() before caching to avoid
//     storing a partial response left behind by a client disconnect.
type responseCapture struct {
	http.ResponseWriter
	body       bytes.Buffer
	statusCode int
	overflowed bool
}

func newResponseCapture(w http.ResponseWriter) *responseCapture {
	return &responseCapture{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rc *responseCapture) WriteHeader(code int) {
	rc.statusCode = code
	rc.ResponseWriter.WriteHeader(code)
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	if !rc.overflowed {
		if rc.body.Len()+len(b) > maxCacheBodyBytes {
			// Release the buffer so GC can reclaim it immediately.
			rc.body = bytes.Buffer{}
			rc.overflowed = true
		} else {
			rc.body.Write(b) //nolint:errcheck
		}
	}
	return rc.ResponseWriter.Write(b)
}

func (rc *responseCapture) Flush() {
	if f, ok := rc.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
