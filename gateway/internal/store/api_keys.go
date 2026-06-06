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

// TouchAPIKey enqueues a key-ID for a batched stats update.
// Non-blocking: if the queue is full the touch is silently dropped — the
// requests counter is advisory, not transactional.
func (s *Store) TouchAPIKey(keyID uuid.UUID) {
	select {
	case s.keyTouchQueue <- keyID:
	default:
		// Queue full under extreme load — skip this touch; never block the request.
	}
}

// keyTouchWriter drains keyTouchQueue every 5 s, deduplicates key IDs,
// and issues a single bulk UPDATE instead of one UPDATE per request.
// Under load a hot key that was touched 1 000 times costs one DB query.
func (s *Store) keyTouchWriter() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	counts := make(map[uuid.UUID]int64) // dedup: key ID → request count since last flush

	flush := func() {
		if len(counts) == 0 {
			return
		}
		ids := make([]string, 0, len(counts))
		incs := make([]int64, 0, len(counts))
		for id, n := range counts {
			ids = append(ids, id.String())
			incs = append(incs, n)
		}
		counts = make(map[uuid.UUID]int64)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := s.pool.Exec(ctx, `
			UPDATE api_keys AS k
			   SET requests     = k.requests + b.cnt,
			       last_used_at = now()
			  FROM (SELECT unnest($1::text[]) AS id, unnest($2::bigint[]) AS cnt) AS b
			 WHERE k.id = b.id::uuid`,
			ids, incs,
		)
		if err != nil {
			logger.Get().Warn("key touch batch failed", slog.String("error", err.Error()))
		}
	}

	for {
		select {
		case id, ok := <-s.keyTouchQueue:
			if !ok {
				flush()
				return
			}
			counts[id]++
		case <-ticker.C:
			flush()
		}
	}
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
