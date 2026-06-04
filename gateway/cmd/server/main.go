package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	
	"github.com/sharvik/llm-firewall/gateway/internal/db"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
	"github.com/sharvik/llm-firewall/gateway/internal/proxy"
)

func main() {
	// 1. Load config
	err := godotenv.Load()
	if err != nil {
		_ = godotenv.Load("../../.env")
	}

	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		log.Fatal("GROQ_API_KEY environment variable is missing")
	}

	// 2. Initialize Subsystems (Titan Architecture)
	ctx := context.Background()
	
	// CockroachDB
	dbConn := "postgresql://root@localhost:26257/defaultdb?sslmode=disable"
	store, _ := db.NewCockroachStore(ctx, dbConn)
	defer store.Close()

	// Redpanda Event Bus
	producer, err := events.NewProducer([]string{"localhost:9092"})
	if err != nil {
		log.Printf("[Redpanda] Warning: Could not connect to event bus: %v", err)
	}
	
	// Cedar Policy Engine
	cedarEngine := policy.NewCedarEngine()

	// 3. Initialize Proxy
	targetURL := "https://api.groq.com/openai"
	llmProxy := proxy.NewLLMProxy(targetURL, apiKey, cedarEngine, producer)

	// 4. Setup Chi Router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("TITAN Gateway is healthy"))
	})

	// Proxy all LLM traffic
	r.Handle("/*", llmProxy)

	// 5. Graceful Shutdown Server
	port := ":8080"
	srv := &http.Server{
		Addr:    port,
		Handler: r,
	}

	go func() {
		log.Printf("🚀 Starting TITAN Gateway on port %s, forwarding to %s\n", port, targetURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %s\n", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down TITAN Gateway gracefully...")

	ctxShutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctxShutdown); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("TITAN Gateway exiting")
}
