package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// GetSettingsRaw returns the persisted runtime-settings JSON document.
// Returns (nil, nil) when no settings have been saved yet so the caller can
// seed defaults.
func (s *Store) GetSettingsRaw(ctx context.Context) ([]byte, error) {
	var data []byte
	err := s.pool.QueryRow(ctx,
		`SELECT data FROM gateway_settings WHERE id = 'global'`).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// SaveSettingsRaw upserts the runtime-settings JSON document. The whole document
// is replaced atomically — callers merge before saving.
func (s *Store) SaveSettingsRaw(ctx context.Context, data []byte) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO gateway_settings (id, data, updated_at)
		VALUES ('global', $1, now())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
		data)
	return err
}
