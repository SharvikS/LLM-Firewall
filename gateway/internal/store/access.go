package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ListUserTenantIDs returns the tenant IDs explicitly assigned to a
// control-plane user. An empty list means global access for backwards
// compatibility with existing installations.
func (s *Store) ListUserTenantIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT tenant_id FROM user_tenant_access WHERE user_id=$1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetUserTenantAccess replaces a user's explicit tenant scope. Passing an empty
// list clears the scope and restores global access.
func (s *Store) SetUserTenantAccess(ctx context.Context, userID uuid.UUID, tenantIDs []uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `DELETE FROM user_tenant_access WHERE user_id=$1`, userID); err != nil {
		return err
	}
	for _, tenantID := range uniqueUUIDs(tenantIDs) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_tenant_access(user_id, tenant_id)
			VALUES($1, $2)
			ON CONFLICT DO NOTHING`, userID, tenantID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListTenantsByIDs(ctx context.Context, tenantIDs []uuid.UUID) ([]Tenant, error) {
	tenantIDs = uniqueUUIDs(tenantIDs)
	if len(tenantIDs) == 0 {
		return []Tenant{}, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id,name,tier,rate_limit,active,created_at
		   FROM tenants
		  WHERE active=true AND id = ANY($1)
		  ORDER BY created_at DESC`, tenantIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTenants(rows)
}

func (s *Store) ListAPIKeysForTenants(ctx context.Context, tenantIDs []uuid.UUID) ([]APIKey, error) {
	tenantIDs = uniqueUUIDs(tenantIDs)
	if len(tenantIDs) == 0 {
		return []APIKey{}, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at
		   FROM api_keys
		  WHERE tenant_id = ANY($1)
		  ORDER BY created_at DESC`, tenantIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAPIKeys(rows)
}

func (s *Store) ListPoliciesForTenants(ctx context.Context, tenantIDs []uuid.UUID) ([]Policy, error) {
	tenantIDs = uniqueUUIDs(tenantIDs)
	if len(tenantIDs) == 0 {
		return []Policy{}, nil
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+policyColumns+`
		   FROM policies
		  WHERE tenant_id IS NULL OR tenant_id = ANY($1)
		  ORDER BY created_at DESC`, tenantIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPolicies(rows)
}

func uniqueUUIDs(in []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(in))
	out := make([]uuid.UUID, 0, len(in))
	for _, id := range in {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func scanTenants(rows pgx.Rows) ([]Tenant, error) {
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

func scanAPIKeys(rows pgx.Rows) ([]APIKey, error) {
	var out []APIKey
	for rows.Next() {
		k, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *k)
	}
	return out, rows.Err()
}

func scanPolicies(rows pgx.Rows) ([]Policy, error) {
	var out []Policy
	for rows.Next() {
		p, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}
