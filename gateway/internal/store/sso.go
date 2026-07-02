package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SSOExchangeCode is the identity bound to a one-time SSO handoff code.
type SSOExchangeCode struct {
	UserID uuid.UUID
	Email  string
	Role   string
}

// CreateSSOExchangeCode stores a hashed, short-lived code for the dashboard
// backend to redeem. The raw code is never persisted.
func (s *Store) CreateSSOExchangeCode(ctx context.Context, rawCode string, userID uuid.UUID, email, role string, ttl time.Duration) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sso_exchange_codes(code_hash, user_id, email, role, expires_at)
		VALUES($1, $2, $3, $4, $5)`,
		hashExchangeCode(rawCode), userID, email, role, time.Now().UTC().Add(ttl),
	)
	return err
}

// ConsumeSSOExchangeCode atomically marks a code as used and returns its bound
// identity. Expired, missing, or already-consumed codes return (nil, nil).
func (s *Store) ConsumeSSOExchangeCode(ctx context.Context, rawCode string) (*SSOExchangeCode, error) {
	var out SSOExchangeCode
	err := s.pool.QueryRow(ctx, `
		UPDATE sso_exchange_codes
		   SET consumed_at = now()
		 WHERE code_hash = $1
		   AND consumed_at IS NULL
		   AND expires_at > now()
		 RETURNING user_id, email, role`,
		hashExchangeCode(rawCode),
	).Scan(&out.UserID, &out.Email, &out.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func hashExchangeCode(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
