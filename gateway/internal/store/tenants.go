package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Tenant mirrors the tenants table.
type Tenant struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Tier         string    `json:"tier"`
	RateLimitRPM int       `json:"rate_limit"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

func (s *Store) GetTenantByID(ctx context.Context, id uuid.UUID) (*Tenant, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id,name,tier,rate_limit,active,created_at FROM tenants WHERE id=$1 AND active=true`,
		id,
	)
	return scanTenant(row)
}

func (s *Store) ListTenants(ctx context.Context) ([]Tenant, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id,name,tier,rate_limit,active,created_at FROM tenants ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Tenant
	for rows.Next() {
		t, err := scanTenant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s *Store) CreateTenant(ctx context.Context, name, tier string, rateLimit int) (*Tenant, error) {
	var t Tenant
	err := s.pool.QueryRow(ctx,
		`INSERT INTO tenants(name,tier,rate_limit) VALUES($1,$2,$3) RETURNING id,name,tier,rate_limit,active,created_at`,
		name, tier, rateLimit,
	).Scan(&t.ID, &t.Name, &t.Tier, &t.RateLimitRPM, &t.Active, &t.CreatedAt)
	return &t, err
}

// scanTenant works with both pgx.Row and pgx.Rows.
func scanTenant(row interface {
	Scan(dest ...any) error
}) (*Tenant, error) {
	var t Tenant
	err := row.Scan(&t.ID, &t.Name, &t.Tier, &t.RateLimitRPM, &t.Active, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &t, err
}
