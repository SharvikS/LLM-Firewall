package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// User is the public (hash-free) view of a control-plane user.
type User struct {
	ID              uuid.UUID  `json:"id"`
	Email           string     `json:"email"`
	Role            string     `json:"role"`
	AuthProvider    string     `json:"auth_provider"`
	ExternalSubject *string    `json:"external_subject,omitempty"`
	Disabled        bool       `json:"disabled"`
	CreatedAt       time.Time  `json:"created_at"`
	LastLogin       *time.Time `json:"last_login,omitempty"`
}

// UserCred carries the fields needed to authenticate a login (includes the hash).
type UserCred struct {
	ID              uuid.UUID
	Email           string
	PasswordHash    string
	Role            string
	AuthProvider    string
	ExternalSubject *string
	Disabled        bool
}

// CreateUser inserts a local or OIDC user. password_hash may be "" for OIDC.
func (s *Store) CreateUser(ctx context.Context, email, passwordHash, role, provider string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users(email, password_hash, role, auth_provider)
		VALUES($1,$2,$3,$4)
		RETURNING id,email,role,auth_provider,external_subject,disabled,created_at,last_login`,
		email, passwordHash, role, provider,
	).Scan(&u.ID, &u.Email, &u.Role, &u.AuthProvider, &u.ExternalSubject, &u.Disabled, &u.CreatedAt, &u.LastLogin)
	return &u, err
}

// GetUserCredByEmail returns auth fields for login. (nil, nil) when not found.
func (s *Store) GetUserCredByEmail(ctx context.Context, email string) (*UserCred, error) {
	var c UserCred
	err := s.pool.QueryRow(ctx,
		`SELECT id,email,password_hash,role,auth_provider,external_subject,disabled FROM users WHERE email=$1`,
		email,
	).Scan(&c.ID, &c.Email, &c.PasswordHash, &c.Role, &c.AuthProvider, &c.ExternalSubject, &c.Disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// GetUserCredByProviderSubject returns a federated user by stable IdP subject.
func (s *Store) GetUserCredByProviderSubject(ctx context.Context, provider, subject string) (*UserCred, error) {
	var c UserCred
	err := s.pool.QueryRow(ctx,
		`SELECT id,email,password_hash,role,auth_provider,external_subject,disabled
		 FROM users WHERE auth_provider=$1 AND external_subject=$2`,
		provider, subject,
	).Scan(&c.ID, &c.Email, &c.PasswordHash, &c.Role, &c.AuthProvider, &c.ExternalSubject, &c.Disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListUsers returns all users (hash-free), newest first.
func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id,email,role,auth_provider,external_subject,disabled,created_at,last_login FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.AuthProvider, &u.ExternalSubject, &u.Disabled, &u.CreatedAt, &u.LastLogin); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountUsers reports how many users exist (used by the bootstrap).
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// UpdateUserRole changes a user's role. Returns (nil, nil) when not found.
func (s *Store) UpdateUserRole(ctx context.Context, id uuid.UUID, role string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `
		UPDATE users SET role=$2 WHERE id=$1
		RETURNING id,email,role,auth_provider,external_subject,disabled,created_at,last_login`,
		id, role,
	).Scan(&u.ID, &u.Email, &u.Role, &u.AuthProvider, &u.ExternalSubject, &u.Disabled, &u.CreatedAt, &u.LastLogin)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// SetUserDisabled enables/disables a user (disabled users can't log in).
func (s *Store) SetUserDisabled(ctx context.Context, id uuid.UUID, disabled bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET disabled=$2 WHERE id=$1`, id, disabled)
	return err
}

// DeleteUser removes a user.
func (s *Store) DeleteUser(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
	return err
}

// TouchLastLogin records a successful login timestamp (fire-and-forget safe).
func (s *Store) TouchLastLogin(ctx context.Context, id uuid.UUID) {
	_, _ = s.pool.Exec(ctx, `UPDATE users SET last_login=now() WHERE id=$1`, id)
}

// UpsertOIDCUser ensures an OIDC-authenticated identity has a user row. New
// users are provisioned with defaultRole; existing users keep their role.
func (s *Store) UpsertOIDCUser(ctx context.Context, email, subject, defaultRole string) (*UserCred, error) {
	if subject != "" {
		existing, err := s.GetUserCredByProviderSubject(ctx, "oidc", subject)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}

	existing, err := s.GetUserCredByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if existing.AuthProvider != "oidc" {
			return nil, errors.New("email already exists with non-OIDC auth provider")
		}
		if existing.ExternalSubject == nil && subject != "" {
			_, err := s.pool.Exec(ctx, `UPDATE users SET external_subject=$2 WHERE id=$1`, existing.ID, subject)
			if err != nil {
				return nil, err
			}
			existing.ExternalSubject = &subject
		}
		return existing, nil
	}
	var u User
	err = s.pool.QueryRow(ctx, `
		INSERT INTO users(email, password_hash, role, auth_provider, external_subject)
		VALUES($1,'',$2,'oidc',$3)
		RETURNING id,email,role,auth_provider,external_subject,disabled,created_at,last_login`,
		email, defaultRole, subject,
	).Scan(&u.ID, &u.Email, &u.Role, &u.AuthProvider, &u.ExternalSubject, &u.Disabled, &u.CreatedAt, &u.LastLogin)
	if err != nil {
		return nil, err
	}
	return &UserCred{ID: u.ID, Email: u.Email, Role: u.Role, AuthProvider: "oidc", ExternalSubject: u.ExternalSubject}, nil
}
