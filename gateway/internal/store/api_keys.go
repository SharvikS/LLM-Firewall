package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
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
	Sandbox    APISandbox `json:"sandbox"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// APISandbox is the per-firewall-key request sandbox. It constrains what a
// client can do after pointing its SDK at TITAN with this API key.
type APISandbox struct {
	Enabled              bool     `json:"enabled"`
	AllowedModels        []string `json:"allowed_models,omitempty"`
	BlockedModels        []string `json:"blocked_models,omitempty"`
	AllowedPaths         []string `json:"allowed_paths,omitempty"`
	MaxRequestsPerMinute int      `json:"max_requests_per_minute,omitempty"`
	MaxTokensPerMinute   int      `json:"max_tokens_per_minute,omitempty"`
	RequirePIIRedaction  bool     `json:"require_pii_redaction,omitempty"`
	RequireOutputScan    bool     `json:"require_output_scan,omitempty"`
}

// GetByHash looks up a key by SHA-256(rawKey).  Returns nil, nil on miss.
func (s *Store) GetAPIKeyByHash(ctx context.Context, hash string) (*APIKey, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at
		   FROM api_keys WHERE key_hash=$1 AND active=true`,
		hash,
	)
	return scanAPIKey(row)
}

func (s *Store) GetAPIKeyByID(ctx context.Context, id uuid.UUID) (*APIKey, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at
		   FROM api_keys WHERE id=$1`,
		id,
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
			`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at
			   FROM api_keys ORDER BY created_at DESC`)
	} else {
		rows, err = s.pool.Query(ctx,
			`SELECT id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at
			   FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC`, tenantID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAPIKeys(rows)
}

// GenerateKey mints a new cryptographically random key, stores its hash, and
// returns the raw key (the only time it is ever visible).
func (s *Store) GenerateAPIKey(ctx context.Context, tenantID uuid.UUID, name string) (rawKey string, key *APIKey, err error) {
	raw, err := generateRawKey()
	if err != nil {
		return "", nil, fmt.Errorf("generate key: %w", err)
	}
	hash := HashKey(raw)
	// raw = "titan_" + 64 hex chars. raw[:8] yielded only "titan_XX" — 256 unique
	// values — making keys indistinguishable in the UI. raw[:14] gives
	// "titan_" + 8 hex chars = 4 billion unique prefixes while remaining readable.
	prefix := raw[:14]

	row := s.pool.QueryRow(ctx,
		`INSERT INTO api_keys(tenant_id,name,key_hash,key_prefix)
		 VALUES($1,$2,$3,$4)
		 RETURNING id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at`,
		tenantID, name, hash, prefix,
	)
	k, err := scanAPIKey(row)
	return raw, k, err
}

// UpdateAPIKeySandbox replaces the sandbox profile attached to an API key.
func (s *Store) UpdateAPIKeySandbox(ctx context.Context, id uuid.UUID, sandbox APISandbox) (*APIKey, error) {
	normalized := normalizeSandbox(sandbox)
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, fmt.Errorf("marshal sandbox: %w", err)
	}
	row := s.pool.QueryRow(ctx,
		`UPDATE api_keys SET sandbox=$2 WHERE id=$1
		 RETURNING id,tenant_id,name,key_hash,key_prefix,active,requests,sandbox,last_used_at,created_at`,
		id, raw,
	)
	return scanAPIKey(row)
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
		// Do NOT clear counts before the DB write. If the exec fails due to a
		// transient error, accumulated values remain in the map and are included
		// in the next flush window rather than being silently lost.
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
			logger.Get().Warn("key touch batch failed — counts retained for next flush",
				slog.String("error", err.Error()))
			return
		}
		counts = make(map[uuid.UUID]int64)
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
	var sandboxRaw []byte
	err := row.Scan(&k.ID, &k.TenantID, &k.Name, &k.KeyHash, &k.KeyPrefix,
		&k.Active, &k.Requests, &sandboxRaw, &k.LastUsedAt, &k.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	k.Sandbox = defaultSandbox()
	if len(sandboxRaw) > 0 {
		_ = json.Unmarshal(sandboxRaw, &k.Sandbox)
		k.Sandbox = normalizeSandbox(k.Sandbox)
	}
	return &k, err
}

func defaultSandbox() APISandbox {
	return APISandbox{
		AllowedPaths: []string{"/v1/chat/completions", "/v1/completions", "/v1/embeddings"},
	}
}

func normalizeSandbox(s APISandbox) APISandbox {
	s.AllowedModels = cleanStringList(s.AllowedModels)
	s.BlockedModels = cleanStringList(s.BlockedModels)
	s.AllowedPaths = cleanStringList(s.AllowedPaths)
	if len(s.AllowedPaths) == 0 {
		s.AllowedPaths = defaultSandbox().AllowedPaths
	}
	if s.MaxRequestsPerMinute < 0 {
		s.MaxRequestsPerMinute = 0
	}
	if s.MaxTokensPerMinute < 0 {
		s.MaxTokensPerMinute = 0
	}
	return s
}

func cleanStringList(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}
