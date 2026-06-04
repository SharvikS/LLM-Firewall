package db

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CockroachStore struct {
	pool *pgxpool.Pool
}

func NewCockroachStore(ctx context.Context, connString string) (*CockroachStore, error) {
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		return nil, err
	}
	
	// Ping to ensure connection
	if err := pool.Ping(ctx); err != nil {
		log.Printf("[CockroachDB] Warning: Could not ping database: %v. Assuming offline for local dev.", err)
		// For local dev without docker, we won't crash here.
		return &CockroachStore{pool: pool}, nil
	}
	
	log.Println("[CockroachDB] Successfully connected to global database cluster")
	return &CockroachStore{pool: pool}, nil
}

func (s *CockroachStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}
