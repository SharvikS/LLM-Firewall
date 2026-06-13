package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"github.com/sharvik/llm-firewall/gateway/internal/analytics"
	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	adminapi "github.com/sharvik/llm-firewall/gateway/internal/api"
	"github.com/sharvik/llm-firewall/gateway/internal/auth"
	"github.com/sharvik/llm-firewall/gateway/internal/batch"
	"github.com/sharvik/llm-firewall/gateway/internal/cache"
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	gatewaymw "github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/plugins"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/proxy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
	"github.com/sharvik/llm-firewall/gateway/internal/settings"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
	"github.com/sharvik/llm-firewall/gateway/internal/telemetry"
)

func main() {
	_ = godotenv.Load()
	log := logger.Get()

	cfg, err := config.Load()
	if err != nil {
		log.Error("configuration error", slog.String("error", err.Error()))
		os.Exit(1)
	}
	log.Info("configuration loaded",
		slog.String("listen", cfg.ListenAddr),
		slog.String("target", cfg.TargetURL),
		slog.String("env", cfg.AppEnv),
	)

	// In production, refuse to start with public default secrets.
	if cfg.IsProduction() {
		if issues := cfg.InsecureDefaults(); len(issues) > 0 {
			for _, issue := range issues {
				log.Error("insecure default in production — refusing to start", slog.String("issue", issue))
			}
			os.Exit(1)
		}
	} else if issues := cfg.InsecureDefaults(); len(issues) > 0 {
		for _, issue := range issues {
			log.Warn("insecure default in use (set APP_ENV=production to enforce)", slog.String("issue", issue))
		}
	}

	ctx := context.Background()

	// ── OpenTelemetry tracing (no-op unless OTEL_EXPORTER_OTLP_ENDPOINT set) ──
	otelShutdown, otelEnabled := telemetry.Setup(ctx)
	defer func() {
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		otelShutdown(flushCtx) //nolint:errcheck
	}()

	// ── Database (hard dependency — auth depends on it) ───────────────────────
	st, err := store.New(ctx, cfg.DBConnString)
	if err != nil {
		log.Error("database unavailable — cannot start (auth depends on DB)",
			slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer st.Close()

	// ── Control-plane auth (sessions + RBAC) ──────────────────────────────────
	// Bootstrap a default admin on first boot so the dashboard is reachable.
	if n, cErr := st.CountUsers(ctx); cErr == nil && n == 0 {
		if hash, hErr := auth.HashPassword(cfg.DefaultAdminPassword); hErr == nil {
			if _, uErr := st.CreateUser(ctx, strings.ToLower(cfg.DefaultAdminEmail), hash, string(auth.RoleAdmin), "local"); uErr == nil {
				log.Info("bootstrapped default admin user", slog.String("email", cfg.DefaultAdminEmail))
			} else {
				log.Warn("default admin bootstrap failed", slog.String("error", uErr.Error()))
			}
		}
	}
	sessionIssuer := auth.NewIssuer(cfg.AuthSigningSecret, time.Duration(cfg.AuthSessionTTLHours)*time.Hour)
	oidcCfg := auth.OIDCConfig{
		Issuer:       cfg.OIDCIssuer,
		ClientID:     cfg.OIDCClientID,
		ClientSecret: cfg.OIDCClientSecret,
		RedirectURL:  cfg.OIDCRedirectURL,
		DefaultRole:  auth.Role(cfg.OIDCDefaultRole),
	}
	var oidcClient *auth.OIDCClient
	if oidcCfg.Enabled() {
		oidcClient = auth.NewOIDCClient(oidcCfg, cfg.AuthSigningSecret)
		log.Info("OIDC SSO enabled", slog.String("issuer", cfg.OIDCIssuer))
	} else {
		log.Info("OIDC SSO disabled — set OIDC_ISSUER + client creds to enable")
	}

	// ── Redis ─────────────────────────────────────────────────────────────────
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	redisUp := false
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Warn("Redis unreachable — rate limiting and caching disabled",
			slog.String("error", err.Error()))
	} else {
		redisUp = true
		log.Info("Redis connected", slog.String("addr", cfg.RedisAddr))
		metrics.Init(redisClient) // activate distributed metrics flush
	}
	defer redisClient.Close()

	limiter := ratelimit.New(redisClient, cfg.RateLimitRPM, time.Duration(cfg.RateLimitWindowSec)*time.Second, cfg.RateLimitTPM)
	exactCache := cache.New(redisClient, time.Duration(cfg.CacheTTLSec)*time.Second)

	// ── Runtime settings plane (dashboard-tunable; persisted in DB) ───────────
	// Seeds from config/env, hydrates any persisted overrides, then fans every
	// change out to the rate limiter, cache, and ML engine — all applied live.
	settingsMgr := settings.NewManager(st, cfg)
	if err := settingsMgr.Load(ctx); err != nil {
		log.Warn("settings load failed — using config defaults", slog.String("error", err.Error()))
	}
	settingsMgr.OnApply(func(s settings.Settings) {
		limiter.SetLimits(s.RateLimitRPM, s.RateLimitTPM)
		exactCache.SetTTL(time.Duration(s.CacheTTLSec) * time.Second)
	})
	settingsMgr.OnApply(settings.NewMLPusher(settings.MLConfigURLFromEmbedding(cfg.EmbeddingURL)))
	settingsMgr.ApplyAll()
	log.Info("runtime settings plane ready")

	// Semantic cache is optional — only created when QDRANT_URL is set.
	var semCache *cache.SemanticCache
	if cfg.QdrantURL != "" {
		semCache = cache.NewSemanticCache(cfg.QdrantURL, cfg.EmbeddingURL, cfg.SemanticCacheThreshold)
	}

	// ── Kafka Producer ────────────────────────────────────────────────────────
	var producer *events.EventProducer
	if len(cfg.KafkaBrokers) > 0 {
		producer, err = events.NewProducer(cfg.KafkaBrokers)
		if err != nil {
			log.Warn("Kafka producer unavailable — audit events will be dropped",
				slog.String("error", err.Error()))
		} else {
			defer producer.Close()
		}
	}

	// ── Kafka Consumer (audit durability) ─────────────────────────────────────
	// The consumer owns the Kafka→DB write path. It is only started when a
	// producer is available (same brokers). Shutdown sequence: cancel context
	// so the poll loop exits, then close the client for a graceful group leave,
	// then wait for the goroutine to return before the DB pool is closed.
	consumerCtx, cancelConsumer := context.WithCancel(context.Background())
	consumerDone := make(chan struct{})
	close(consumerDone) // default: already done (no-op wait if consumer not started)
	defer cancelConsumer()

	if producer != nil {
		consumer, consErr := events.NewConsumer(cfg.KafkaBrokers, st)
		if consErr != nil {
			log.Warn("Kafka consumer unavailable — audit DB persistence disabled",
				slog.String("error", consErr.Error()))
		} else {
			consumerDone = make(chan struct{})
			go func() {
				defer close(consumerDone)
				consumer.Start(consumerCtx)
			}()
			defer func() {
				cancelConsumer()
				consumer.Close()
				<-consumerDone
			}()
		}
	}

	// ── ML Analyzer gRPC Client ───────────────────────────────────────────────
	mlClient, err := analyzer.New(
		cfg.AnalyzerAddr,
		time.Duration(cfg.AnalyzerTimeoutMs)*time.Millisecond,
		cfg.AnalyzerTLSEnabled,
		cfg.AnalyzerTLSCertFile,
	)
	if err != nil {
		log.Warn("ML analyzer unavailable — requests will fail-open on ML gate",
			slog.String("error", err.Error()))
	} else {
		defer mlClient.Close()
	}

	// ── Batch processing manager (Redis-backed job state, ML governance) ──────
	batchRedis := redisClient
	if !redisUp {
		batchRedis = nil // fall back to in-memory job state
	}
	batchMgr := batch.NewManager(batchRedis, mlClient, cfg.TargetURL, cfg.APIKey)

	// ── ClickHouse analytics (optional OLAP read path) ────────────────────────
	chClient := analytics.New(cfg.ClickHouseURL, cfg.ClickHouseUser, cfg.ClickHousePassword, cfg.ClickHouseDatabase)
	if chClient.Enabled() {
		log.Info("ClickHouse analytics enabled", slog.String("url", cfg.ClickHouseURL))
	} else {
		log.Info("ClickHouse analytics disabled — set CLICKHOUSE_URL to enable")
	}

	// ── Policy Engine (DB-backed, 30s refresh) ────────────────────────────────
	policyEngine := policy.NewEngine(st)

	// ── WASM custom-rule plugins (optional) ───────────────────────────────────
	pluginRT, err := plugins.Load(ctx, cfg.PluginDir, time.Duration(cfg.PluginTimeoutMs)*time.Millisecond)
	if err != nil {
		// A plugin runtime failure must never take the gateway down — degrade to
		// a disabled plugin stage and keep serving. Individual bad plugins are
		// already skipped inside Load; this guards the rare runtime-init error.
		log.Warn("plugin runtime init failed — plugin stage disabled", slog.String("error", err.Error()))
		pluginRT, _ = plugins.Load(ctx, "", 0)
	}
	if pluginRT.Enabled() {
		log.Info("WASM plugins enabled", slog.Int("count", pluginRT.Count()), slog.String("dir", cfg.PluginDir))
		defer pluginRT.Close(context.Background())
	} else {
		log.Info("WASM plugins disabled — set PLUGIN_DIR to enable")
	}

	// ── Proxy ─────────────────────────────────────────────────────────────────
	llmProxy, err := proxy.NewLLMProxy(cfg, policyEngine, producer, limiter, exactCache, semCache, mlClient, st, pluginRT, settingsMgr)
	if err != nil {
		log.Error("proxy init failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// ── Router ────────────────────────────────────────────────────────────────
	r := chi.NewRouter()
	r.Use(telemetry.Middleware(otelEnabled))
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(gatewaymw.SecurityHeaders)
	r.Use(gatewaymw.StructuredLogger)
	r.Use(chimiddleware.Recoverer)
	r.Use(gatewaymw.MaxBodySize(cfg.MaxRequestBodyBytes))

	// Health — liveness only (always 200 while the process is up).
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"titan-gateway"}`)) //nolint:errcheck
	})

	// Readiness — probes downstream dependencies. The DB is the only hard
	// dependency (auth needs it); Redis and the ML engine are reported but
	// degrade gracefully, so they never flip readiness to false.
	r.Get("/ready", func(w http.ResponseWriter, req *http.Request) {
		probeCtx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		comps := map[string]string{}
		ready := true
		if err := st.Pool().Ping(probeCtx); err != nil {
			comps["database"] = "down"
			ready = false
		} else {
			comps["database"] = "ok"
		}
		if err := redisClient.Ping(probeCtx).Err(); err != nil {
			comps["redis"] = "degraded"
		} else {
			comps["redis"] = "ok"
		}
		if mlClient != nil {
			comps["ml_engine"] = "configured"
		} else {
			comps["ml_engine"] = "fail-open"
		}
		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"ready": ready, "components": comps,
		})
	})

	// Dashboard read API (no auth — metrics are not sensitive)
	r.Route("/api", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				if req.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				next.ServeHTTP(w, req)
			})
		})
		r.Get("/metrics", metricsHandler)
		r.Get("/events", eventsHandler)

		// ClickHouse-backed OLAP analytics (503 when CLICKHOUSE_URL unset)
		ah := adminapi.NewAnalyticsHandler(chClient)
		r.Get("/analytics/overview", ah.Overview)
		r.Get("/analytics/timeseries", ah.Timeseries)
		r.Get("/analytics/threats", ah.Threats)
	})

	// API reference (public — the contract exposes no secrets)
	r.Get("/openapi.json", adminapi.OpenAPISpecHandler)
	r.Get("/docs", adminapi.SwaggerUIHandler)

	// Admin API (token-gated — called server-side only from Next.js)
	r.Mount("/admin/v1", adminapi.NewAdminRouter(adminapi.AdminDeps{
		Store:           st,
		MasterToken:     cfg.AdminToken,
		Settings:        settingsMgr,
		Issuer:          sessionIssuer,
		OIDC:            oidcClient,
		OIDCEnabled:     oidcCfg.Enabled(),
		DefaultOIDCRole: auth.Role(cfg.OIDCDefaultRole),
		DashboardURL:    cfg.DashboardURL,
	}))

	// LLM proxy — all /v1/* routes require a valid API key (fail-closed)
	r.Group(func(r chi.Router) {
		r.Use(gatewaymw.APIKeyAuth(st))

		// Batch API — specific routes must be registered before the proxy
		// wildcard so chi matches them first.
		batchHandler := adminapi.NewBatchHandler(batchMgr)
		r.Post("/v1/batch", batchHandler.Submit)
		r.Get("/v1/batch/{id}", batchHandler.Status)

		r.Handle("/*", llmProxy)
	})

	// ── HTTP Server ───────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		ReadTimeout:  time.Duration(cfg.ReadTimeoutSec) * time.Second,
		WriteTimeout: time.Duration(cfg.WriteTimeoutSec) * time.Second,
		IdleTimeout:  time.Duration(cfg.IdleTimeoutSec) * time.Second,
	}

	go func() {
		log.Info("TITAN Gateway starting", slog.String("addr", cfg.ListenAddr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server error", slog.String("error", err.Error()))
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutdown — draining connections")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("forced shutdown", slog.String("error", err.Error()))
		os.Exit(1)
	}
	log.Info("TITAN Gateway stopped cleanly")
}

// ── Dashboard read handlers ───────────────────────────────────────────────────

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	// GlobalSnapshot reads from Redis (aggregate cross-replica view) and
	// falls back to local in-process counters if Redis is unavailable.
	snap := metrics.GlobalSnapshot(r.Context())
	cr := snap.CacheHits + snap.CacheMisses
	hitRate := 0.0
	if cr > 0 {
		hitRate = float64(snap.CacheHits) / float64(cr) * 100
	}
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(map[string]any{ //nolint:errcheck
		"total_requests":   snap.TotalRequests,
		"allowed_requests": snap.AllowedRequests,
		"blocked_requests": snap.BlockedRequests,
		"rate_limited":     snap.RateLimited,
		"cache_hits":       snap.CacheHits,
		"cache_misses":     snap.CacheMisses,
		"cache_hit_rate":   hitRate,
		"ml_blocked":       snap.MLBlocked,
		"pii_masked":       snap.PIIMasked,
		"cedar_blocked":    snap.CedarBlocked,
		"p99_latency_ms":   snap.P99LatencyMs,
		"avg_latency_ms":   snap.AvgLatencyMs,
		"uptime_seconds":   int64(time.Since(metrics.StartTime).Seconds()),
		"traffic_chart":    snap.TrafficChart,
	})
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	n := 50
	if nStr := r.URL.Query().Get("n"); nStr != "" {
		if parsed, err := strconv.Atoi(nStr); err == nil && parsed > 0 && parsed <= 200 {
			n = parsed
		}
	}
	// GlobalEvents reads from the cluster-wide Redis list so all gateway
	// replicas contribute to the dashboard feed; falls back to local ring
	// buffer when Redis is unavailable.
	events := metrics.GlobalEvents(r.Context(), n)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"events": events,
		"count":  len(events),
	})
}
