package db

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(ctx context.Context, connString string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, err
	}

	// Connection pool tuning: enough headroom for Phase 2 Redis + policy
	// lookups without exhausting the CockroachDB connection limit.
	cfg.MaxConns = 10
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}

	if err := pool.Ping(ctx); err != nil {
		// Non-fatal for local development without Docker running.
		logger.Get().Warn("database unreachable — continuing without DB",
			slog.String("error", err.Error()),
		)
		return &Store{pool: pool}, nil
	}

	logger.Get().Info("database connected",
		slog.Int("max_conns", int(cfg.MaxConns)),
	)
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
		logger.Get().Info("database connection pool closed")
	}
}

// Pool exposes the underlying pool for Phase 2 query methods.
func (s *Store) Pool() *pgxpool.Pool {
	return s.pool
}
