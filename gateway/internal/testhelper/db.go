// Package testhelper provides shared utilities for integration tests.
// All tests that need a real database call OpenTestDB, which connects to
// titan_test and runs migrations fresh on every call.
package testhelper

import (
	"context"
	"os"
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// DBConnString returns the DSN for the test database.
// Override with DB_TEST_CONN_STRING env var in CI.
func DBConnString() string {
	if v := os.Getenv("DB_TEST_CONN_STRING"); v != "" {
		return v
	}
	return "postgresql://localhost/titan_test?sslmode=disable"
}

// OpenTestDB connects to titan_test, runs migrations (idempotent), and
// registers a cleanup that truncates all data tables after the test.
func OpenTestDB(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(context.Background(), DBConnString())
	if err != nil {
		t.Fatalf("testhelper: open titan_test: %v", err)
	}
	registerCleanup(t, st)
	return st
}

// OpenTestDBOrSkip is OpenTestDB for environments where the test database is
// optional: the test is skipped (not failed) when no DB is reachable, so the
// suite stays green on machines/CI runners without infra.
func OpenTestDBOrSkip(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(context.Background(), DBConnString())
	if err != nil {
		t.Skipf("integration test skipped — test DB unreachable (%v); set DB_TEST_CONN_STRING to enable", err)
	}
	registerCleanup(t, st)
	return st
}

func registerCleanup(t *testing.T, st *store.Store) {
	t.Helper()
	t.Cleanup(func() {
		// Clear data tables (FK order) but keep schema so the next test
		// starts clean. Plain DELETEs — CockroachDB rejects PostgreSQL's
		// TRUNCATE ... RESTART IDENTITY form.
		ctx := context.Background()
		for _, table := range []string{"audit_events", "api_keys", "policies", "tenants"} {
			if _, err := st.Pool().Exec(ctx, "DELETE FROM "+table); err != nil {
				t.Logf("testhelper: cleanup of %s failed: %v", table, err)
			}
		}
		st.Close()
	})
}
