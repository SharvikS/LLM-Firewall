package events

import (
	"context"
	"encoding/json"
	"log"

	"github.com/twmb/franz-go/pkg/kgo"
)

type AuditEvent struct {
	EventID   string  `json:"event_id"`
	TenantID  string  `json:"tenant_id"`
	Action    string  `json:"action"`
	RiskScore float64 `json:"risk_score"`
	Provider  string  `json:"provider"`
	Model     string  `json:"model"`
	Prompt    string  `json:"prompt"`
}

type EventProducer struct {
	client *kgo.Client
}

func NewProducer(brokers []string) (*EventProducer, error) {
	cl, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
	)
	if err != nil {
		return nil, err
	}
	return &EventProducer{client: cl}, nil
}

func (p *EventProducer) EmitAudit(ctx context.Context, event AuditEvent) {
	b, err := json.Marshal(event)
	if err != nil {
		log.Printf("[Redpanda] Failed to marshal event: %v", err)
		return
	}
	record := &kgo.Record{Topic: "audit_logs", Value: b}
	
	// Fire and forget - latency optimized
	p.client.Produce(ctx, record, func(_ *kgo.Record, err error) {
		if err != nil {
			log.Printf("[Redpanda] Failed to produce event: %v", err)
		} else {
			log.Printf("[Redpanda] Successfully published audit event: %s", event.EventID)
		}
	})
}
