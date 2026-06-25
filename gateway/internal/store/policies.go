package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Policy mirrors the policies table.
type Policy struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    *uuid.UUID `json:"tenant_id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Effect      string     `json:"effect"`
	Principal   string     `json:"principal"`
	Action      string     `json:"action"`
	Condition   string     `json:"condition"`
	CedarText   *string    `json:"cedar_text,omitempty"`
	Enabled     bool       `json:"enabled"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

const policyColumns = `id,tenant_id,name,description,effect,principal,action,condition,cedar_text,enabled,created_at,updated_at`

// PolicyVersion is an immutable policy snapshot for audit/review workflows.
type PolicyVersion struct {
	ID         uuid.UUID       `json:"id"`
	PolicyID   uuid.UUID       `json:"policy_id"`
	Version    int             `json:"version"`
	ChangeType string          `json:"change_type"`
	Snapshot   json.RawMessage `json:"snapshot"`
	ActorEmail *string         `json:"actor_email,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

func (s *Store) ListPolicies(ctx context.Context, tenantID *uuid.UUID) ([]Policy, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if tenantID == nil {
		rows, err = s.pool.Query(ctx,
			`SELECT `+policyColumns+` FROM policies ORDER BY created_at DESC`)
	} else {
		rows, err = s.pool.Query(ctx,
			`SELECT `+policyColumns+` FROM policies WHERE tenant_id IS NULL OR tenant_id=$1 ORDER BY created_at DESC`,
			*tenantID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

func (s *Store) GetPolicy(ctx context.Context, id uuid.UUID) (*Policy, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+policyColumns+` FROM policies WHERE id=$1`, id)
	return scanPolicy(row)
}

type CreatePolicyInput struct {
	TenantID    *uuid.UUID
	Name        string
	Description string
	Effect      string
	Principal   string
	Action      string
	Condition   string
}

func (s *Store) CreatePolicy(ctx context.Context, inp CreatePolicyInput) (*Policy, error) {
	row := s.pool.QueryRow(ctx,
		`INSERT INTO policies(tenant_id,name,description,effect,principal,action,condition)
		 VALUES($1,$2,$3,$4,$5,$6,$7)
		 RETURNING `+policyColumns,
		inp.TenantID, inp.Name, inp.Description, inp.Effect, inp.Principal, inp.Action, inp.Condition,
	)
	return scanPolicy(row)
}

type UpdatePolicyInput struct {
	Name        string
	Description string
	Effect      string
	Principal   string
	Action      string
	Condition   string
	Enabled     bool
}

func (s *Store) UpdatePolicy(ctx context.Context, id uuid.UUID, inp UpdatePolicyInput) (*Policy, error) {
	p, err := scanPolicy(s.pool.QueryRow(ctx,
		`UPDATE policies
		    SET name=$2,description=$3,effect=$4,principal=$5,action=$6,condition=$7,enabled=$8,updated_at=now()
		  WHERE id=$1
		  RETURNING `+policyColumns,
		id, inp.Name, inp.Description, inp.Effect, inp.Principal, inp.Action, inp.Condition, inp.Enabled,
	))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) DeletePolicy(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM policies WHERE id=$1`, id)
	return err
}

// RecordPolicyVersion stores an immutable snapshot of a policy. It computes the
// next version in the database so concurrent admin updates stay ordered.
func (s *Store) RecordPolicyVersion(ctx context.Context, p Policy, changeType, actorEmail string) (*PolicyVersion, error) {
	raw, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	var v PolicyVersion
	err = s.pool.QueryRow(ctx, `
		INSERT INTO policy_versions(policy_id, version, change_type, snapshot, actor_email)
		VALUES(
			$1,
			COALESCE((SELECT max(version) + 1 FROM policy_versions WHERE policy_id=$1), 1),
			$2,
			$3,
			NULLIF($4, '')
		)
		RETURNING id, policy_id, version, change_type, snapshot, actor_email, created_at`,
		p.ID, changeType, raw, actorEmail,
	).Scan(&v.ID, &v.PolicyID, &v.Version, &v.ChangeType, &v.Snapshot, &v.ActorEmail, &v.CreatedAt)
	return &v, err
}

func (s *Store) ListPolicyVersions(ctx context.Context, policyID uuid.UUID, limit int) ([]PolicyVersion, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, policy_id, version, change_type, snapshot, actor_email, created_at
		FROM policy_versions
		WHERE policy_id=$1
		ORDER BY version DESC
		LIMIT $2`, policyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PolicyVersion
	for rows.Next() {
		var v PolicyVersion
		if err := rows.Scan(&v.ID, &v.PolicyID, &v.Version, &v.ChangeType, &v.Snapshot, &v.ActorEmail, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func scanPolicy(row interface{ Scan(dest ...any) error }) (*Policy, error) {
	var p Policy
	err := row.Scan(
		&p.ID, &p.TenantID, &p.Name, &p.Description, &p.Effect,
		&p.Principal, &p.Action, &p.Condition, &p.CedarText,
		&p.Enabled, &p.CreatedAt, &p.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &p, err
}
