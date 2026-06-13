package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// GetSettingsByID returns the settings JSON document for the given id ('global'
// for the base config, or a tenant UUID string for a per-tenant override patch).
// Returns (nil, nil) when no row exists.
func (s *Store) GetSettingsByID(ctx context.Context, id string) ([]byte, error) {
	var data []byte
	err := s.pool.QueryRow(ctx,
		`SELECT data FROM gateway_settings WHERE id = $1`, id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// SaveSettingsByID upserts the settings document for the given id.
func (s *Store) SaveSettingsByID(ctx context.Context, id string, data []byte) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO gateway_settings (id, data, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
		id, data)
	return err
}

// ListAllSettings returns every settings row keyed by id (incl. 'global' and all
// per-tenant override patches). Used by the settings manager at startup.
func (s *Store) ListAllSettings(ctx context.Context) (map[string][]byte, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, data FROM gateway_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]byte)
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			return nil, err
		}
		out[id] = data
	}
	return out, rows.Err()
}

// DeleteSettingsByID removes a per-tenant override (reverts the tenant to global).
func (s *Store) DeleteSettingsByID(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM gateway_settings WHERE id = $1`, id)
	return err
}
