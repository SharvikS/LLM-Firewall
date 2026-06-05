// Package store is the repository layer — all database I/O lives here.
// Every method is context-aware and concurrency-safe.
package store

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

//go:embed sql/*.sql
var sqlFS embed.FS

// Store wraps the pgxpool and exposes typed repository methods for every table.
type Store struct {
	pool       *pgxpool.Pool
	auditQueue chan AuditRow // buffered → background batch writer
}

// New opens the pool, runs migrations idempotently, and starts the background
// audit writer. An unreachable DB is a hard startup failure — auth depends on it.
func New(ctx context.Context, connString string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("store: parse DSN: %w", err)
	}
	cfg.MaxConns = 15
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping failed: %w", err)
	}

	s := &Store{pool: pool, auditQueue: make(chan AuditRow, 4096)}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: migrate: %w", err)
	}
	go s.auditBatchWriter()

	logger.Get().Info("store: connected and migrated")
	return s, nil
}

func (s *Store) Close() {
	close(s.auditQueue)
	s.pool.Close()
	logger.Get().Info("store: pool closed")
}

// Pool exposes the underlying pool for admin-API query helpers.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// migrate executes every *.sql file in sql/ in lexicographic order.
// Files are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
func (s *Store) migrate(ctx context.Context) error {
	entries, err := sqlFS.ReadDir("sql")
	if err != nil {
		return fmt.Errorf("read embedded sql/: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		data, err := sqlFS.ReadFile("sql/" + e.Name())
		if err != nil {
			return fmt.Errorf("read %s: %w", e.Name(), err)
		}
		if _, err := s.pool.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("exec %s: %w", e.Name(), err)
		}
		logger.Get().Info("migration applied", slog.String("file", e.Name()))
	}
	return nil
}
