package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration for the gateway. Values are loaded
// from environment variables; see Load() for defaults.
type Config struct {
	ListenAddr          string
	TargetURL           string
	APIKey              string
	DBConnString        string
	KafkaBrokers        []string
	MaxRequestBodyBytes int64
	ReadTimeoutSec      int
	WriteTimeoutSec     int
	IdleTimeoutSec      int

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Rate limiting (sliding window, per tenant)
	RateLimitRPM       int64 // requests per minute
	RateLimitWindowSec int   // window size in seconds

	// Semantic cache
	CacheTTLSec int

	// ML Engine (Python gRPC)
	AnalyzerAddr        string
	AnalyzerTimeoutMs   int
	AnalyzerTLSEnabled  bool   // set ANALYZER_TLS_ENABLED=true to enable mTLS
	AnalyzerTLSCertFile string // CA cert (or server cert) for client-side verification

	// Provider failover — optional secondary upstream for 5xx/transport errors
	FallbackTargetURL string // e.g. "https://api.openai.com/v1"
	FallbackAPIKey    string // API key for the fallback provider

	// Token-based rate limiting (Tokens Per Minute); 0 = disabled
	RateLimitTPM int64

	// Response-side output scanning: run the (non-streaming) upstream LLM
	// response through the ML engine to mask PII/secrets the model may emit
	// before it reaches the client. Default on; fail-open on any error.
	OutputScanEnabled   bool
	OutputScanTimeoutMs int // ML deadline for output scans (looser than inline)

	// WASM custom-rule plugins: directory of .wasm detection modules run as an
	// extra pipeline stage. Empty = disabled. Each call is bounded by the timeout.
	PluginDir       string
	PluginTimeoutMs int

	// Semantic cache (Qdrant vector DB + embedding service)
	QdrantURL              string  // e.g. "http://localhost:6333"; empty = disabled
	EmbeddingURL           string  // embedding HTTP endpoint, e.g. "http://localhost:8001/embed"
	SemanticCacheThreshold float64 // cosine similarity threshold (0 < x ≤ 1.0)

	// ML governance gate defaults — these run in the Python engine but the
	// gateway reads the same env vars to seed the runtime-settings document so
	// the dashboard starts in sync with the engine.
	ToxicityEnabled        bool
	ToxicityBlockThreshold float64
	CodeLeakBlock          bool

	// Admin API
	AdminToken string // master secret for /admin/* routes — never NEXT_PUBLIC_

	// ClickHouse analytics (OLAP read path); empty URL = disabled
	ClickHouseURL      string // e.g. "http://localhost:8123"
	ClickHouseUser     string
	ClickHousePassword string
	ClickHouseDatabase string
}

// Load reads environment variables and returns a validated Config.
// Returns an error if any required variable is absent.
func Load() (*Config, error) {
	cfg := &Config{
		ListenAddr:          getEnv("LISTEN_ADDR", ":8080"),
		TargetURL:           getEnv("TARGET_URL", "https://api.groq.com/openai"),
		APIKey:              os.Getenv("GROQ_API_KEY"),
		DBConnString:        getEnv("DB_CONN_STRING", "postgresql://localhost/titan_dev?sslmode=disable"),
		KafkaBrokers:        splitComma(getEnv("KAFKA_BROKERS", "localhost:9092")),
		MaxRequestBodyBytes: getEnvInt64("MAX_REQUEST_BODY_BYTES", 4*1024*1024), // 4 MB
		ReadTimeoutSec:      getEnvInt("READ_TIMEOUT_SEC", 30),
		WriteTimeoutSec:     getEnvInt("WRITE_TIMEOUT_SEC", 90), // generous for long completions
		IdleTimeoutSec:      getEnvInt("IDLE_TIMEOUT_SEC", 120),

		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		RateLimitRPM:       getEnvInt64("RATE_LIMIT_RPM", 60),
		RateLimitWindowSec: getEnvInt("RATE_LIMIT_WINDOW_SEC", 60),

		CacheTTLSec: getEnvInt("CACHE_TTL_SEC", 3600),

		AnalyzerAddr:        getEnv("ANALYZER_ADDR", "localhost:50051"),
		AnalyzerTimeoutMs:   getEnvInt("ANALYZER_TIMEOUT_MS", 150),
		AnalyzerTLSEnabled:  getEnvBool("ANALYZER_TLS_ENABLED", false),
		AnalyzerTLSCertFile: getEnv("ANALYZER_TLS_CERT_FILE", "/etc/certs/tls.crt"),

		FallbackTargetURL:   os.Getenv("FALLBACK_TARGET_URL"),
		FallbackAPIKey:      os.Getenv("FALLBACK_API_KEY"),
		RateLimitTPM:        getEnvInt64("RATE_LIMIT_TPM", 0),
		OutputScanEnabled:   getEnvBool("OUTPUT_SCAN_ENABLED", true),
		OutputScanTimeoutMs: getEnvInt("OUTPUT_SCAN_TIMEOUT_MS", 2000),

		PluginDir:       os.Getenv("PLUGIN_DIR"),
		PluginTimeoutMs: getEnvInt("PLUGIN_TIMEOUT_MS", 500),

		QdrantURL:              os.Getenv("QDRANT_URL"),
		EmbeddingURL:           getEnv("EMBEDDING_URL", "http://localhost:8001/embed"),
		SemanticCacheThreshold: getEnvFloat64("SEMANTIC_CACHE_THRESHOLD", 0.95),

		ToxicityEnabled:        getEnvBool("TOXICITY_ENABLED", true),
		ToxicityBlockThreshold: getEnvFloat64("TOXICITY_BLOCK_THRESHOLD", 0.85),
		CodeLeakBlock:          getEnvBool("CODE_LEAK_BLOCK", false),

		AdminToken: getEnv("ADMIN_TOKEN", "titan-admin-dev-secret"),

		ClickHouseURL:      os.Getenv("CLICKHOUSE_URL"),
		ClickHouseUser:     getEnv("CLICKHOUSE_USER", "default"),
		ClickHousePassword: os.Getenv("CLICKHOUSE_PASSWORD"),
		ClickHouseDatabase: getEnv("CLICKHOUSE_DATABASE", "titan"),
	}

	if cfg.APIKey == "" {
		return nil, fmt.Errorf("GROQ_API_KEY environment variable is required")
	}
	if cfg.TargetURL == "" {
		return nil, fmt.Errorf("TARGET_URL must not be empty")
	}

	return cfg, nil
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func getEnvInt64(key string, defaultVal int64) int64 {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if v := os.Getenv(key); v != "" {
		return strings.ToLower(v) == "true" || v == "1"
	}
	return defaultVal
}

func getEnvFloat64(key string, defaultVal float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return defaultVal
}

func splitComma(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
