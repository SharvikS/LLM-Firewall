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

	"github.com/sharvik/llm-firewall/gateway/internal/analyzer"
	"github.com/sharvik/llm-firewall/gateway/internal/cache"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	"github.com/sharvik/llm-firewall/gateway/internal/config"
	"github.com/sharvik/llm-firewall/gateway/internal/db"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	gatewaymw "github.com/sharvik/llm-firewall/gateway/internal/middleware"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/proxy"
	"github.com/sharvik/llm-firewall/gateway/internal/ratelimit"
)

func main() {
	_ = godotenv.Load()

	log := logger.Get()

	// --- Config ---
	cfg, err := config.Load()
	if err != nil {
		log.Error("configuration error", slog.String("error", err.Error()))
		os.Exit(1)
	}
	log.Info("configuration loaded",
		slog.String("listen", cfg.ListenAddr),
		slog.String("target", cfg.TargetURL),
		slog.Int64("rate_limit_rpm", cfg.RateLimitRPM),
		slog.Int("cache_ttl_sec", cfg.CacheTTLSec),
	)

	ctx := context.Background()

	// --- Redis ---
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Warn("Redis unreachable — rate limiting and caching disabled",
			slog.String("addr", cfg.RedisAddr),
			slog.String("error", err.Error()),
		)
	} else {
		log.Info("Redis connected", slog.String("addr", cfg.RedisAddr))
	}
	defer redisClient.Close()

	// --- Rate Limiter ---
	limiter := ratelimit.New(
		redisClient,
		cfg.RateLimitRPM,
		time.Duration(cfg.RateLimitWindowSec)*time.Second,
	)

	// --- Semantic Cache ---
	semanticCache := cache.New(
		redisClient,
		time.Duration(cfg.CacheTTLSec)*time.Second,
	)

	// --- Database ---
	store, err := db.NewStore(ctx, cfg.DBConnString)
	if err != nil {
		log.Warn("database init failed — running without persistent storage",
			slog.String("error", err.Error()),
		)
	} else {
		defer store.Close()
	}

	// --- Kafka Producer ---
	producer, err := events.NewProducer(cfg.KafkaBrokers)
	if err != nil {
		log.Warn("kafka producer unavailable — audit logging disabled",
			slog.String("error", err.Error()),
		)
	} else {
		defer producer.Close()
	}

	// --- ML Analyzer gRPC Client ---
	mlClient, err := analyzer.New(
		cfg.AnalyzerAddr,
		time.Duration(cfg.AnalyzerTimeoutMs)*time.Millisecond,
	)
	if err != nil {
		log.Warn("ML analyzer unavailable — requests will fail-open",
			slog.String("addr", cfg.AnalyzerAddr),
			slog.String("error", err.Error()),
		)
		mlClient = nil
	} else {
		defer mlClient.Close()
	}

	// --- Proxy ---
	cedarEngine := policy.NewCedarEngine()
	llmProxy, err := proxy.NewLLMProxy(cfg, cedarEngine, producer, limiter, semanticCache, mlClient)
	if err != nil {
		log.Error("failed to initialise proxy", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// --- Router ---
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(gatewaymw.SecurityHeaders)
	r.Use(gatewaymw.StructuredLogger)
	r.Use(chimiddleware.Recoverer)
	r.Use(gatewaymw.MaxBodySize(cfg.MaxRequestBodyBytes))

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"titan-gateway"}`)) //nolint:errcheck
	})

	// Dashboard read API — CORS headers allow the Next.js dev server to poll.
	r.Route("/api", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				if req.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				next.ServeHTTP(w, req)
			})
		})
		r.Get("/metrics", metricsHandler)
		r.Get("/events", eventsHandler)
	})

	r.Handle("/*", llmProxy)

	// --- HTTP Server ---
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

	log.Info("shutdown signal received — draining connections")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("forced shutdown", slog.String("error", err.Error()))
		os.Exit(1)
	}
	log.Info("TITAN Gateway stopped cleanly")
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	g := metrics.Global
	total := g.TotalRequests.Load()
	hits := g.CacheHits.Load()
	misses := g.CacheMisses.Load()
	cacheRequests := hits + misses
	hitRate := 0.0
	if cacheRequests > 0 {
		hitRate = float64(hits) / float64(cacheRequests) * 100
	}

	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(map[string]any{ //nolint:errcheck
		"total_requests":    total,
		"allowed_requests":  g.AllowedRequests.Load(),
		"blocked_requests":  g.BlockedRequests.Load(),
		"rate_limited":      g.RateLimited.Load(),
		"cache_hits":        hits,
		"cache_misses":      misses,
		"cache_hit_rate":    hitRate,
		"ml_blocked":        g.MLBlocked.Load(),
		"pii_masked":        g.PIIMasked.Load(),
		"cedar_blocked":     g.CedarBlocked.Load(),
		"p99_latency_ms":    metrics.Latency.P99(),
		"avg_latency_ms":    metrics.Latency.Avg(),
		"uptime_seconds":    int64(time.Since(metrics.StartTime).Seconds()),
		"traffic_chart":     metrics.HourlyTraffic.Snapshot(),
	})
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	n := 50
	if nStr := r.URL.Query().Get("n"); nStr != "" {
		if parsed, err := strconv.Atoi(nStr); err == nil && parsed > 0 && parsed <= 200 {
			n = parsed
		}
	}
	events := metrics.Events.Last(n)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"events": events, "count": len(events)}) //nolint:errcheck
}
