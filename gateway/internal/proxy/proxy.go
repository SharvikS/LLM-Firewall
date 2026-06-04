package proxy

import (
	"context"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/policy"
)

// LLMProxy is the main reverse proxy struct
type LLMProxy struct {
	Proxy        *httputil.ReverseProxy
	CedarEngine  *policy.CedarEngine
	EventProducer *events.EventProducer
}

// NewLLMProxy creates the advanced Zero-Trust Reverse Proxy
func NewLLMProxy(targetURL string, apiKey string, cedar *policy.CedarEngine, producer *events.EventProducer) *LLMProxy {
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

	return &LLMProxy{
		Proxy:        proxy,
		CedarEngine:  cedar,
		EventProducer: producer,
	}
}

func (p *LLMProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	// Phase 1: Policy Evaluation (Cedar)
	// Simulate extracting metadata from the request
	contextData := map[string]interface{}{
		"risk_score": 10.0, // In reality, this comes from the Python ML Analyzer
		"region":     "US",
	}

	allowed, _ := p.CedarEngine.Evaluate(ctx, "tenant_123", "InvokeLLM", "OpenAI_GPT4", contextData)
	if !allowed {
		http.Error(w, "Blocked by Cedar Security Policy", http.StatusForbidden)
		
		// Fire audit event for blocked request
		p.emitAudit("tenant_123", "BLOCKED", 95.0)
		return
	}

	// Phase 2: Forward Request
	p.Proxy.ServeHTTP(w, r)

	// Phase 3: Audit Logging to Redpanda
	p.emitAudit("tenant_123", "ALLOWED", 10.0)
}

func (p *LLMProxy) emitAudit(tenantID, action string, risk float64) {
	if p.EventProducer == nil {
		return
	}
	
	event := events.AuditEvent{
		EventID:   uuid.New().String(),
		TenantID:  tenantID,
		Action:    action,
		RiskScore: risk,
		Provider:  "Groq",
		Model:     "llama3-8b",
		Prompt:    "[REDACTED_BY_ASR]",
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	
	p.EventProducer.EmitAudit(ctx, event)
}
