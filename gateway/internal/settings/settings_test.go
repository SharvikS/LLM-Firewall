package settings

import (
	"context"
	"testing"

	"github.com/sharvik/llm-firewall/gateway/internal/config"
)

// memStore is an in-memory store stand-in for the persistence interface.
type memStore struct {
	data []byte
}

func (m *memStore) GetSettingsRaw(_ context.Context) ([]byte, error) { return m.data, nil }
func (m *memStore) SaveSettingsRaw(_ context.Context, d []byte) error {
	m.data = append([]byte(nil), d...)
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
	st := &memStore{}
	m := NewManager(st, baseCfg())
	if err := m.Load(context.Background()); err != nil {
		t.Fatalf("load: %v", err)
	}
	if st.data == nil {
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
	m := NewManager(&memStore{}, baseCfg())
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
	m := NewManager(&memStore{}, baseCfg())
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
	st := &memStore{}
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
