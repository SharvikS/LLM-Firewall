package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AuditRow is the write-side DTO for a single audit event. EventID maps to the
// Kafka AuditEvent.EventID and is used for idempotent consumer inserts.
type AuditRow struct {
	EventID    string
	RequestID  string
	TenantID   *uuid.UUID
	APIKeyID   *uuid.UUID
	Action     string
	RiskScore  float64
	Path       string
	LatencyMs  int64
	StatusCode int
	Reason     string
	Region     string
}

// ListAuditEvents returns paginated audit events newest-first.
func (s *Store) ListAuditEvents(ctx context.Context, tenantID *uuid.UUID, limit, offset int) ([]AuditEventRow, int, error) {
	var (
		total int
		rows  interface{ Scan(...any) error }
	)

	const cols = `id,request_id,tenant_id,api_key_id,action,risk_score,path,latency_ms,status_code,reason,region,created_at`
	countQ := `SELECT COUNT(*) FROM audit_events`
	listQ  := `SELECT ` + cols + ` FROM audit_events`
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
		err := pgRows.Scan(
			&e.ID, &e.RequestID, &e.TenantID, &e.APIKeyID, &e.Action,
			&e.RiskScore, &e.Path, &e.LatencyMs, &e.StatusCode, &e.Reason,
			&e.Region, &e.CreatedAt,
		)
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
	Region     string     `json:"region"`
	CreatedAt  time.Time  `json:"created_at"`
}

// InsertAuditBatch writes all rows in a single network round-trip using
// pgx.SendBatch (PostgreSQL pipelined extended query protocol).
// ON CONFLICT DO NOTHING makes inserts idempotent — safe for Kafka at-least-once redelivery.
func (s *Store) InsertAuditBatch(ctx context.Context, rows []AuditRow) error {
	if len(rows) == 0 {
		return nil
	}
	const q = `INSERT INTO audit_events
		(event_id,request_id,tenant_id,api_key_id,action,risk_score,path,latency_ms,status_code,reason,region)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT DO NOTHING`

	batch := &pgx.Batch{}
	for _, r := range rows {
		region := r.Region
		if region == "" {
			region = "unknown"
		}
		var eventID *string
		if r.EventID != "" {
			s := r.EventID
			eventID = &s
		}
		batch.Queue(q,
			eventID, r.RequestID, r.TenantID, r.APIKeyID, r.Action, r.RiskScore,
			r.Path, r.LatencyMs, r.StatusCode, r.Reason, region,
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
