package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// AuditEvent is the canonical audit record written to the "audit_logs" Kafka
// topic. Every field must be present so downstream consumers (ClickHouse,
// Grafana) can build accurate analytics without schema gymnastics.
type AuditEvent struct {
	EventID    string    `json:"event_id"`
	RequestID  string    `json:"request_id"`
	TenantID   string    `json:"tenant_id"`
	Action     string    `json:"action"`     // "ALLOWED" | "BLOCKED"
	RiskScore  float64   `json:"risk_score"`
	Provider   string    `json:"provider"`
	Model      string    `json:"model"`
	Prompt     string    `json:"prompt"`
	StatusCode int       `json:"status_code"`
	LatencyMs  int64     `json:"latency_ms"`
	Timestamp  time.Time `json:"timestamp"`
}

type EventProducer struct {
	client *kgo.Client
}

func NewProducer(brokers []string) (*EventProducer, error) {
	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		return nil, err
	}
	logger.Get().Info("kafka producer initialised", slog.Any("brokers", brokers))
	return &EventProducer{client: cl}, nil
}

// EmitAudit publishes an AuditEvent asynchronously. The fire-and-forget
// callback pattern keeps zero latency impact on the request path.
func (p *EventProducer) EmitAudit(ctx context.Context, event AuditEvent) {
	b, err := json.Marshal(event)
	if err != nil {
		logger.Get().Error("failed to marshal audit event",
			slog.String("error", err.Error()),
			slog.String("event_id", event.EventID),
		)
		return
	}

	record := &kgo.Record{Topic: "audit_logs", Value: b}
	p.client.Produce(ctx, record, func(_ *kgo.Record, err error) {
		if err != nil {
			logger.Get().Error("kafka produce failed",
				slog.String("error", err.Error()),
				slog.String("event_id", event.EventID),
			)
		} else {
			logger.Get().Debug("audit event published",
				slog.String("event_id", event.EventID),
				slog.String("action", event.Action),
			)
		}
	})
}

func (p *EventProducer) Close() {
	if p.client != nil {
		p.client.Close()
		logger.Get().Info("kafka producer closed")
	}
}
