package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// APIKey mirrors the api_keys table. Raw key is never stored here.
type APIKey struct {
	ID         uuid.UUID  `json:"id"`
	TenantID   uuid.UUID  `json:"tenant_id"`
	Name       string     `json:"name"`
	KeyHash    string     `json:"-"` // never expose hash over API
	KeyPrefix  string     `json:"key_prefix"`
	Active     bool       `json:"active"`
	Requests   int64      `json:"requests"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// GetByHash looks up a key by SHA-256(rawKey).  Returns nil, nil on miss.
func (s *Store) GetAPIKeyByHash(ctx context.Context, hash string) (*APIKey, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,last_used_at,created_at
		   FROM api_keys WHERE key_hash=$1 AND active=true`,
		hash,
	)
	return scanAPIKey(row)
}

// ListKeys returns all keys for a tenant (or all keys if tenantID is zero).
func (s *Store) ListAPIKeys(ctx context.Context, tenantID uuid.UUID) ([]APIKey, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if tenantID == uuid.Nil {
		rows, err = s.pool.Query(ctx,
			`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,last_used_at,created_at
			   FROM api_keys ORDER BY created_at DESC`)
	} else {
		rows, err = s.pool.Query(ctx,
			`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,last_used_at,created_at
			   FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC`, tenantID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

// GenerateKey mints a new cryptographically random key, stores its hash, and
// returns the raw key (the only time it is ever visible).
func (s *Store) GenerateAPIKey(ctx context.Context, tenantID uuid.UUID, name string) (rawKey string, key *APIKey, err error) {
	raw, err := generateRawKey()
	if err != nil {
		return "", nil, fmt.Errorf("generate key: %w", err)
	}
	hash := HashKey(raw)
	prefix := raw[:8]

	k := &APIKey{}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO api_keys(tenant_id,name,key_hash,key_prefix)
		 VALUES($1,$2,$3,$4)
		 RETURNING id,tenant_id,name,key_hash,key_prefix,active,requests,last_used_at,created_at`,
		tenantID, name, hash, prefix,
	).Scan(&k.ID, &k.TenantID, &k.Name, &k.KeyHash, &k.KeyPrefix, &k.Active, &k.Requests, &k.LastUsedAt, &k.CreatedAt)
	return raw, k, err
}

// RevokeAPIKey soft-deletes a key (sets active=false).
func (s *Store) RevokeAPIKey(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE api_keys SET active=false WHERE id=$1`, id)
	return err
}

// TouchAPIKey increments request count and updates last_used_at asynchronously.
// Fire-and-forget: use a background context so it never blocks the request path.
func (s *Store) TouchAPIKey(keyID uuid.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		s.pool.Exec(ctx, //nolint:errcheck
			`UPDATE api_keys SET requests=requests+1, last_used_at=now() WHERE id=$1`,
			keyID,
		)
	}()
}

// HashKey returns the hex-encoded SHA-256 of a raw API key.
func HashKey(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func generateRawKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "titan_" + hex.EncodeToString(b), nil
}

func scanAPIKey(row interface{ Scan(dest ...any) error }) (*APIKey, error) {
	var k APIKey
	err := row.Scan(&k.ID, &k.TenantID, &k.Name, &k.KeyHash, &k.KeyPrefix,
		&k.Active, &k.Requests, &k.LastUsedAt, &k.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &k, err
}
