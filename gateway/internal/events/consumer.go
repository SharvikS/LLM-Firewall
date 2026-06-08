package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// EventConsumer reads AuditEvents from the "audit_logs" Kafka topic and
// batch-inserts them into the database. Offsets are committed only after a
// successful DB write, giving at-least-once delivery semantics.
// Duplicate events on redelivery are silently dropped by the DB's ON CONFLICT.
type EventConsumer struct {
	cl *kgo.Client
	st *store.Store
}

// NewConsumer creates a consumer-group client subscribed to "audit_logs".
// BlockRebalanceOnPoll prevents a partition rebalance from racing with the
// in-progress batch write.
func NewConsumer(brokers []string, st *store.Store) (*EventConsumer, error) {
	cl, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ConsumerGroup("titan-audit-consumer"),
		kgo.ConsumeTopics("audit_logs"),
		kgo.BlockRebalanceOnPoll(),
	)
	if err != nil {
		return nil, err
	}
	logger.Get().Info("kafka consumer initialised", slog.Any("brokers", brokers))
	return &EventConsumer{cl: cl, st: st}, nil
}

// Start polls Kafka in a loop and writes micro-batches (up to 50 records) to
// the database. It returns when ctx is cancelled (graceful shutdown).
func (c *EventConsumer) Start(ctx context.Context) {
	log := logger.Get()
	for {
		fetches := c.cl.PollRecords(ctx, 50)
		if fetches.IsClientClosed() {
			return
		}
		if ctx.Err() != nil {
			c.cl.AllowRebalance()
			return
		}

		var rows []store.AuditRow
		var records []*kgo.Record
		fetches.EachRecord(func(r *kgo.Record) {
			var evt AuditEvent
			if err := json.Unmarshal(r.Value, &evt); err != nil {
				log.Error("consumer: unmarshal failed — skipping record",
					slog.String("error", err.Error()),
					slog.String("topic", r.Topic),
					slog.Int64("offset", r.Offset),
				)
				return
			}
			rows = append(rows, auditEventToRow(evt))
			records = append(records, r)
		})

		if len(rows) > 0 {
			insertCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := c.st.InsertAuditBatch(insertCtx, rows)
			cancel()
			if err != nil {
				log.Error("consumer: db batch insert failed — offsets not committed, will retry",
					slog.String("error", err.Error()),
					slog.Int("batch_size", len(rows)),
				)
				c.cl.AllowRebalance()
				continue
			}
			if err := c.cl.CommitRecords(ctx, records...); err != nil && ctx.Err() == nil {
				log.Error("consumer: offset commit failed",
					slog.String("error", err.Error()),
				)
			}
		}

		c.cl.AllowRebalance()
	}
}

// Close performs a graceful leave from the consumer group and closes the client.
func (c *EventConsumer) Close() {
	if c.cl != nil {
		c.cl.Close()
		logger.Get().Info("kafka consumer closed")
	}
}

// auditEventToRow converts a Kafka AuditEvent into a store.AuditRow for DB insertion.
// UUID strings that fail to parse (or are empty) are mapped to nil pointers.
func auditEventToRow(e AuditEvent) store.AuditRow {
	row := store.AuditRow{
		EventID:    e.EventID,
		RequestID:  e.RequestID,
		Action:     e.Action,
		RiskScore:  e.RiskScore,
		Path:       e.Path,
		LatencyMs:  e.LatencyMs,
		StatusCode: e.StatusCode,
		Reason:     e.Reason,
		Region:     e.Region,
	}
	if id, err := uuid.Parse(e.TenantID); err == nil && id != uuid.Nil {
		row.TenantID = &id
	}
	if id, err := uuid.Parse(e.APIKeyID); err == nil && id != uuid.Nil {
		row.APIKeyID = &id
	}
	return row
}
