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
	AnalyzerAddr      string
	AnalyzerTimeoutMs int

	// Admin API
	AdminToken string // master secret for /admin/* routes — never NEXT_PUBLIC_
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

		AnalyzerAddr:      getEnv("ANALYZER_ADDR", "localhost:50051"),
		AnalyzerTimeoutMs: getEnvInt("ANALYZER_TIMEOUT_MS", 150),

		AdminToken: getEnv("ADMIN_TOKEN", "titan-admin-dev-secret"),
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

func splitComma(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
