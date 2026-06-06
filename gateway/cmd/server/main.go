package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	adminapi "github.com/sharvik/llm-firewall/gateway/internal/api"
	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	"github.com/sharvik/llm-firewall/gateway/internal/cache"
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	gatewaymw "github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/proxy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
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
	)

	ctx := context.Background()

	// ── Database (hard dependency — auth depends on it) ───────────────────────
	st, err := store.New(ctx, cfg.DBConnString)
	if err != nil {
		log.Error("database unavailable — cannot start (auth depends on DB)",
			slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer st.Close()

	// ── Redis ─────────────────────────────────────────────────────────────────
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Warn("Redis unreachable — rate limiting and caching disabled",
			slog.String("error", err.Error()))
	} else {
		log.Info("Redis connected", slog.String("addr", cfg.RedisAddr))
		metrics.Init(redisClient) // activate distributed metrics flush
	}
	defer redisClient.Close()

	limiter    := ratelimit.New(redisClient, cfg.RateLimitRPM, time.Duration(cfg.RateLimitWindowSec)*time.Second, cfg.RateLimitTPM)
	exactCache := cache.New(redisClient, time.Duration(cfg.CacheTTLSec)*time.Second)

	// Semantic cache is optional — only created when QDRANT_URL is set.
	var semCache *cache.SemanticCache
	if cfg.QdrantURL != "" {
		semCache = cache.NewSemanticCache(cfg.QdrantURL, cfg.EmbeddingURL, cfg.SemanticCacheThreshold)
	}

	// ── Kafka Producer ────────────────────────────────────────────────────────
	producer, err := events.NewProducer(cfg.KafkaBrokers)
	if err != nil {
		log.Warn("Kafka producer unavailable — audit streaming disabled",
			slog.String("error", err.Error()))
	} else {
		defer producer.Close()
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

	// ── Policy Engine (DB-backed, 30s refresh) ────────────────────────────────
	policyEngine := policy.NewEngine(st)

	// ── Proxy ─────────────────────────────────────────────────────────────────
	llmProxy, err := proxy.NewLLMProxy(cfg, policyEngine, producer, limiter, exactCache, semCache, mlClient, st)
	if err != nil {
		log.Error("proxy init failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// ── Router ────────────────────────────────────────────────────────────────
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(gatewaymw.SecurityHeaders)
	r.Use(gatewaymw.StructuredLogger)
	r.Use(chimiddleware.Recoverer)
	r.Use(gatewaymw.MaxBodySize(cfg.MaxRequestBodyBytes))

	// Health (no auth)
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"titan-gateway"}`)) //nolint:errcheck
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
		r.Get("/events",  eventsHandler)
	})

	// Admin API (token-gated — called server-side only from Next.js)
	r.Mount("/admin/v1", adminapi.NewAdminRouter(st, cfg.AdminToken))

	// LLM proxy — all /v1/* routes require a valid API key (fail-closed)
	r.Group(func(r chi.Router) {
		r.Use(gatewaymw.APIKeyAuth(st))
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
