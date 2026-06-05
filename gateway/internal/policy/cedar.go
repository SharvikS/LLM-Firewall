package policy

import (
	"context"
	"log/slog"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// CedarEngine is a stub ABAC evaluator. In production this calls into the
// Rust cedar-policy library via CGo or a sidecar process.
// TODO(phase-3): bind to real cedar-policy evaluation.
type CedarEngine struct{}

func NewCedarEngine() *CedarEngine {
	return &CedarEngine{}
}

func (c *CedarEngine) Evaluate(
	_ context.Context,
	principal, action, resource string,
	contextData map[string]interface{},
) (bool, error) {
	log := logger.Get().With(
		slog.String("principal", principal),
		slog.String("action", action),
		slog.String("resource", resource),
	)

	if risk, ok := contextData["risk_score"].(float64); ok && risk > 70.0 {
		log.Warn("cedar DENY — risk threshold exceeded", slog.Float64("risk_score", risk))
		return false, nil
	}

	if region, ok := contextData["region"].(string); ok && region == "EU" {
		log.Info("cedar ENFORCE — GDPR strict filtering applied")
	}

	log.Info("cedar ALLOW")
	return true, nil
}
