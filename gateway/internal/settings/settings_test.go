package settings

import (
	"context"
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/config"
)

// memStore is an in-memory store stand-in for the persistence interface.
type memStore struct {
	rows map[string][]byte
}

func newMemStore() *memStore { return &memStore{rows: map[string][]byte{}} }

func (m *memStore) GetSettingsByID(_ context.Context, id string) ([]byte, error) {
	return m.rows[id], nil
}
func (m *memStore) SaveSettingsByID(_ context.Context, id string, d []byte) error {
	if m.rows == nil {
		m.rows = map[string][]byte{}
	}
	m.rows[id] = append([]byte(nil), d...)
	return nil
}
func (m *memStore) ListAllSettings(_ context.Context) (map[string][]byte, error) {
	out := map[string][]byte{}
	for k, v := range m.rows {
		out[k] = append([]byte(nil), v...)
	}
	return out, nil
}
func (m *memStore) DeleteSettingsByID(_ context.Context, id string) error {
	delete(m.rows, id)
	return nil
}

func baseCfg() *config.Config {
	return &config.Config{
		RateLimitRPM:           60,
		RateLimitTPM:           0,
		CacheTTLSec:            3600,
		AnalyzerTimeoutMs:      150,
		OutputScanEnabled:      true,
		ToxicityEnabled:        true,
		ToxicityBlockThreshold: 0.85,
	}
}

func TestLoadSeedsDefaultsWhenEmpty(t *testing.T) {
	st := newMemStore()
	m := NewManager(st, baseCfg())
	if err := m.Load(context.Background()); err != nil {
		t.Fatalf("load: %v", err)
	}
	if st.rows["global"] == nil {
		t.Fatal("Load should persist seed defaults when store is empty")
	}
	if got := m.Get().RateLimitRPM; got != 60 {
		t.Fatalf("seed RPM = %d, want 60", got)
	}
	if m.Get().PIIEntities["US_SSN"] != true {
		t.Fatal("default PII entities not seeded")
	}
}

func TestUpdateMergesAndClamps(t *testing.T) {
	m := NewManager(newMemStore(), baseCfg())
	_ = m.Load(context.Background())

	// Partial patch: only RPM and an out-of-range analyzer timeout.
	out, err := m.Update(context.Background(), []byte(`{"rate_limit_rpm":120,"analyzer_timeout_ms":99999}`))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if out.RateLimitRPM != 120 {
		t.Fatalf("RPM not applied: %d", out.RateLimitRPM)
	}
	if out.AnalyzerTimeoutMs != 10000 {
		t.Fatalf("analyzer timeout not clamped: %d", out.AnalyzerTimeoutMs)
	}
	// Untouched field keeps its seeded value.
	if out.CacheTTLSec != 3600 {
		t.Fatalf("merge clobbered cache ttl: %d", out.CacheTTLSec)
	}
}

func TestApplyHooksFire(t *testing.T) {
	m := NewManager(newMemStore(), baseCfg())
	_ = m.Load(context.Background())

	var seenRPM int64
	m.OnApply(func(s Settings) { seenRPM = s.RateLimitRPM })
	m.ApplyAll()
	if seenRPM != 60 {
		t.Fatalf("ApplyAll did not fire hook with seed: %d", seenRPM)
	}
	_, _ = m.Update(context.Background(), []byte(`{"rate_limit_rpm":200}`))
	if seenRPM != 200 {
		t.Fatalf("Update did not fire hook: %d", seenRPM)
	}
}

func TestPersistedOverridesSurviveReload(t *testing.T) {
	st := newMemStore()
	m1 := NewManager(st, baseCfg())
	_ = m1.Load(context.Background())
	_, _ = m1.Update(context.Background(), []byte(`{"cache_ttl_sec":60}`))

	// New manager backed by the same store should observe the override.
	m2 := NewManager(st, baseCfg())
	if err := m2.Load(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if m2.Get().CacheTTLSec != 60 {
		t.Fatalf("override did not survive reload: %d", m2.Get().CacheTTLSec)
	}
}

func TestPerTenantOverrideLayersOverGlobal(t *testing.T) {
	st := newMemStore()
	m := NewManager(st, baseCfg())
	_ = m.Load(context.Background())

	const tenant = "11111111-1111-1111-1111-111111111111"
	// Tenant overrides only RPM; everything else should fall through to global.
	if _, err := m.UpdateForTenant(context.Background(), tenant, []byte(`{"rate_limit_rpm":500}`)); err != nil {
		t.Fatalf("update tenant: %v", err)
	}
	eff := m.GetForTenant(tenant)
	if eff.RateLimitRPM != 500 {
		t.Fatalf("tenant RPM override not applied: %d", eff.RateLimitRPM)
	}
	if eff.CacheTTLSec != m.Get().CacheTTLSec {
		t.Fatal("non-overridden key should fall through to global")
	}
	// A different tenant with no override sees pure global.
	if m.GetForTenant("22222222-2222-2222-2222-222222222222").RateLimitRPM != m.Get().RateLimitRPM {
		t.Fatal("unrelated tenant should see global RPM")
	}

	// Global change still flows through for keys the tenant didn't override.
	_, _ = m.Update(context.Background(), []byte(`{"cache_ttl_sec":123}`))
	if m.GetForTenant(tenant).CacheTTLSec != 123 {
		t.Fatal("global change should flow through to tenant for non-overridden keys")
	}

	// Reload from store preserves the tenant patch.
	m2 := NewManager(st, baseCfg())
	_ = m2.Load(context.Background())
	if m2.GetForTenant(tenant).RateLimitRPM != 500 {
		t.Fatal("tenant override did not survive reload")
	}

	// Clearing reverts to global.
	_ = m.ClearTenant(context.Background(), tenant)
	if m.GetForTenant(tenant).RateLimitRPM != m.Get().RateLimitRPM {
		t.Fatal("ClearTenant should revert to global")
	}
}
