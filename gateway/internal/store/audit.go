package store

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// AuditRow is the struct written to the audit_events table.
type AuditRow struct {
	RequestID  string
	TenantID   *uuid.UUID
	APIKeyID   *uuid.UUID
	Action     string
	RiskScore  float64
	Path       string
	LatencyMs  int64
	StatusCode int
	Reason     string
}

// EnqueueAudit pushes a row onto the background write queue.
// Non-blocking: if the queue is full the row is dropped rather than stalling the request.
func (s *Store) EnqueueAudit(row AuditRow) {
	select {
	case s.auditQueue <- row:
	default:
		logger.Get().Warn("audit queue full — row dropped",
			slog.String("request_id", row.RequestID))
	}
}

// ListAuditEvents returns paginated audit events newest-first.
func (s *Store) ListAuditEvents(ctx context.Context, tenantID *uuid.UUID, limit, offset int) ([]AuditEventRow, int, error) {
	var (
		total int
		rows  interface{ Scan(...any) error }
	)

	countQ := `SELECT COUNT(*) FROM audit_events`
	listQ  := `SELECT id,request_id,tenant_id,api_key_id,action,risk_score,path,latency_ms,status_code,reason,created_at FROM audit_events`
	args   := []any{}
	if tenantID != nil {
		countQ += ` WHERE tenant_id=$1`
		listQ  += ` WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
		args    = []any{*tenantID, limit, offset}
	} else {
		listQ += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`
		args   = []any{limit, offset}
	}

	// Count
	if tenantID != nil {
		s.pool.QueryRow(ctx, countQ, *tenantID).Scan(&total) //nolint:errcheck
	} else {
		s.pool.QueryRow(ctx, countQ).Scan(&total) //nolint:errcheck
	}

	pgRows, err := s.pool.Query(ctx, listQ, args...)
	if err != nil {
		return nil, total, err
	}
	defer pgRows.Close()

	var out []AuditEventRow
	for pgRows.Next() {
		var e AuditEventRow
		err := pgRows.Scan(&e.ID, &e.RequestID, &e.TenantID, &e.APIKeyID, &e.Action,
			&e.RiskScore, &e.Path, &e.LatencyMs, &e.StatusCode, &e.Reason, &e.CreatedAt)
		if err != nil {
			return nil, total, err
		}
		_ = rows
		out = append(out, e)
	}
	return out, total, pgRows.Err()
}

// AuditEventRow is the read-side DTO for the admin API.
type AuditEventRow struct {
	ID         uuid.UUID  `json:"id"`
	RequestID  string     `json:"request_id"`
	TenantID   *uuid.UUID `json:"tenant_id"`
	APIKeyID   *uuid.UUID `json:"api_key_id"`
	Action     string     `json:"action"`
	RiskScore  *float64   `json:"risk_score"`
	Path       *string    `json:"path"`
	LatencyMs  *int64     `json:"latency_ms"`
	StatusCode *int       `json:"status_code"`
	Reason     *string    `json:"reason"`
	CreatedAt  time.Time  `json:"created_at"`
}

// auditBatchWriter drains auditQueue in micro-batches of up to 50 rows or
// every 500ms, whichever comes first.  Off the hot path entirely.
func (s *Store) auditBatchWriter() {
	const batchSize = 50
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	batch := make([]AuditRow, 0, batchSize)

	flush := func() {
		if len(batch) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.insertAuditBatch(ctx, batch); err != nil {
			logger.Get().Error("audit batch write failed", slog.String("error", err.Error()))
		}
		batch = batch[:0]
	}

	for {
		select {
		case row, ok := <-s.auditQueue:
			if !ok {
				flush()
				return
			}
			batch = append(batch, row)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// insertAuditBatch writes all rows in a single network round-trip using
// pgx.SendBatch (PostgreSQL pipelined extended query protocol).
// This replaces the previous N×(BEGIN + INSERT + COMMIT) pattern with
// a single pipeline flush — one TCP round-trip for any batch size.
func (s *Store) insertAuditBatch(ctx context.Context, rows []AuditRow) error {
	if len(rows) == 0 {
		return nil
	}
	const q = `INSERT INTO audit_events
		(request_id,tenant_id,api_key_id,action,risk_score,path,latency_ms,status_code,reason)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`

	batch := &pgx.Batch{}
	for _, r := range rows {
		batch.Queue(q,
			r.RequestID, r.TenantID, r.APIKeyID, r.Action, r.RiskScore,
			r.Path, r.LatencyMs, r.StatusCode, r.Reason,
		)
	}
	results := s.pool.SendBatch(ctx, batch)
	defer results.Close()

	for range rows {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
}
