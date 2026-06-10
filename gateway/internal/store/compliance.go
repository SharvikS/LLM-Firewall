package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ComplianceSummary aggregates the audit trail for a reporting period.
// It backs the SOC2/GDPR evidence report on the admin API.
type ComplianceSummary struct {
	From            time.Time        `json:"period_from"`
	To              time.Time        `json:"period_to"`
	TotalEvents     int64            `json:"total_events"`
	ActionBreakdown map[string]int64 `json:"action_breakdown"`
	UniqueTenants   int64            `json:"unique_tenants"`
	AvgRiskScore    float64          `json:"avg_risk_score"`
	MaxRiskScore    float64          `json:"max_risk_score"`
	RegionBreakdown map[string]int64 `json:"region_breakdown"`
}

// GetComplianceSummary computes period aggregates in three indexed queries.
func (s *Store) GetComplianceSummary(ctx context.Context, tenantID *uuid.UUID, from, to time.Time) (*ComplianceSummary, error) {
	out := &ComplianceSummary{
		From:            from,
		To:              to,
		ActionBreakdown: map[string]int64{},
		RegionBreakdown: map[string]int64{},
	}

	tenantCond := ""
	args := []any{from, to}
	if tenantID != nil {
		tenantCond = " AND tenant_id=$3"
		args = append(args, *tenantID)
	}

	headQ := `SELECT COUNT(*), COUNT(DISTINCT tenant_id),
	                 COALESCE(AVG(risk_score),0), COALESCE(MAX(risk_score),0)
	          FROM audit_events WHERE created_at >= $1 AND created_at < $2` + tenantCond
	if err := s.pool.QueryRow(ctx, headQ, args...).Scan(
		&out.TotalEvents, &out.UniqueTenants, &out.AvgRiskScore, &out.MaxRiskScore,
	); err != nil {
		return nil, err
	}

	actionQ := `SELECT action, COUNT(*) FROM audit_events
	            WHERE created_at >= $1 AND created_at < $2` + tenantCond + ` GROUP BY action`
	rows, err := s.pool.Query(ctx, actionQ, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var action string
		var n int64
		if err := rows.Scan(&action, &n); err != nil {
			return nil, err
		}
		out.ActionBreakdown[action] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	regionQ := `SELECT region, COUNT(*) FROM audit_events
	            WHERE created_at >= $1 AND created_at < $2` + tenantCond + ` GROUP BY region`
	rRows, err := s.pool.Query(ctx, regionQ, args...)
	if err != nil {
		return nil, err
	}
	defer rRows.Close()
	for rRows.Next() {
		var region string
		var n int64
		if err := rRows.Scan(&region, &n); err != nil {
			return nil, err
		}
		out.RegionBreakdown[region] = n
	}
	return out, rRows.Err()
}

// StreamAuditRange invokes fn for every audit event in [from, to), oldest
// page first (each page newest-first internally is re-walked in order),
// paging with the keyset cursor so memory stays bounded regardless of the
// export size. fn returning an error aborts the stream.
func (s *Store) StreamAuditRange(ctx context.Context, tenantID *uuid.UUID, from, to time.Time, fn func(AuditEventRow) error) error {
	// Seed the cursor just past `to` so the first keyset page starts at the
	// newest row inside the window.
	cursor := &AuditCursor{CreatedAt: to, ID: uuid.Max}
	const pageSize = 1000

	for {
		rows, next, err := s.ListAuditEventsCursor(ctx, tenantID, pageSize, cursor)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if r.CreatedAt.Before(from) {
				return nil // walked past the window — done
			}
			if err := fn(r); err != nil {
				return err
			}
		}
		if next == nil {
			return nil
		}
		cursor = next
	}
}
