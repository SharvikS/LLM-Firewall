package main

import (
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/sharvik/llm-firewall/gateway/internal/proxy"
)

func main() {
	// Try loading from the current dir, or fallback to the root gateway dir
	err := godotenv.Load()
	if err != nil {
		err = godotenv.Load("../../.env")
		if err != nil {
			log.Println("No .env file found, relying on system environment variables")
		}
	}

	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		log.Fatal("GROQ_API_KEY environment variable is missing")
	}

	// Groq's OpenAI-compatible endpoint
	targetURL := "https://api.groq.com/openai"
	port := ":8080"

	// Initialize the proxy
	llmProxy := proxy.NewLLMProxy(targetURL, apiKey)

	// Set up the HTTP router
	mux := http.NewServeMux()
	
	// Catch all routes and send to proxy
	mux.Handle("/", llmProxy)

	log.Printf("Starting LLM Gateway on port %s, forwarding to %s\n", port, targetURL)
	
	// Start the server
	serverErr := http.ListenAndServe(port, mux)
	if serverErr != nil {
		log.Fatal("Server failed to start:", serverErr)
	}
}
