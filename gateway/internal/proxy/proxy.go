package proxy

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// NewLLMProxy creates a reverse proxy pointed at the target LLM API (e.g. Groq)
func NewLLMProxy(targetURL string, apiKey string) *httputil.ReverseProxy {
	target, err := url.Parse(targetURL)
	if err != nil {
		log.Fatal("Invalid target URL:", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	// Modify the request BEFORE it goes to the LLM Provider
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		
		// 1. Ensure the Host header matches the target
		req.Host = target.Host
		
		// 2. Inject the real API Key securely
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	// Modify the response AFTER it returns from the LLM Provider
	proxy.ModifyResponse = func(resp *http.Response) error {
		return nil
	}

	return proxy
}
