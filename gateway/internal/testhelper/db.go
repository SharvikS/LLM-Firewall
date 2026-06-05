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
	t.Cleanup(func() {
		// Truncate data tables but keep schema so the next test starts clean.
		st.Pool().Exec(context.Background(), //nolint:errcheck
			`TRUNCATE api_keys, policies, audit_events, tenants RESTART IDENTITY CASCADE`)
		st.Close()
	})
	return st
}
