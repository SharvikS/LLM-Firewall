// Package settings is the runtime-configuration plane for the gateway.
//
// Everything here is editable from the dashboard (PUT /admin/v1/settings) and
// applied live — no restart. The Manager keeps an in-memory snapshot, persists
// the full document to the DB on every change, and fans changes out to
// registered apply hooks (rate limiter, cache, ML-engine push). Startup seeds
// defaults from the process Config/env so behaviour is identical to the old
// env-only model until an operator changes something.
package settings

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/sharvik/llm-firewall/gateway/internal/config"
)

// Settings holds every dashboard-tunable knob. Field names are stable JSON keys
// shared with the dashboard; do not rename without updating the UI.
type Settings struct {
	// ── Gateway plane (applied in-process) ────────────────────────────────────
	RateLimitRPM      int64 `json:"rate_limit_rpm"`
	RateLimitTPM      int64 `json:"rate_limit_tpm"`
	CacheTTLSec       int   `json:"cache_ttl_sec"`
	AnalyzerTimeoutMs int   `json:"analyzer_timeout_ms"`
	OutputScanEnabled bool  `json:"output_scan_enabled"`
	FailoverEnabled   bool  `json:"failover_enabled"`
	AuditAllRequests  bool  `json:"audit_all_requests"`

	// ── ML plane (pushed to the Python engine over HTTP) ──────────────────────
	PIIRedactionEnabled    bool            `json:"pii_redaction_enabled"`
	ToxicityEnabled        bool            `json:"toxicity_enabled"`
	ToxicityBlockThreshold float64         `json:"toxicity_block_threshold"`
	CodeLeakBlock          bool            `json:"code_leak_block"`
	PIIEntities            map[string]bool `json:"pii_entities"`
}

// store is the minimal persistence surface the Manager needs, satisfied by
// *store.Store. Declared as an interface to avoid a hard import cycle and to
// keep the package unit-testable.
type store interface {
	GetSettingsRaw(ctx context.Context) ([]byte, error)
	SaveSettingsRaw(ctx context.Context, data []byte) error
}

// ApplyFunc is a hook invoked with the freshly-applied settings on every change
// (and once at startup via ApplyAll). Hooks must be cheap and non-blocking.
type ApplyFunc func(Settings)

// Manager owns the live settings snapshot.
type Manager struct {
	st       store
	mu       sync.RWMutex
	current  Settings
	applyFns []ApplyFunc
}

// DefaultPIIEntities is the Presidio recognizer allowlist surfaced on the Data
// Privacy tab. true = mask occurrences of that entity.
func DefaultPIIEntities() map[string]bool {
	return map[string]bool{
		"US_SSN":        true,
		"EMAIL_ADDRESS": true,
		"CREDIT_CARD":   true,
		"PHONE_NUMBER":  true,
		"PERSON":        true,
		"IP_ADDRESS":    true,
		"US_PASSPORT":   false,
		"IBAN_CODE":     true,
	}
}

// DefaultsFromConfig builds the seed settings from the loaded process Config so
// the runtime plane starts identical to the env-configured behaviour.
func DefaultsFromConfig(cfg *config.Config) Settings {
	return Settings{
		RateLimitRPM:      cfg.RateLimitRPM,
		RateLimitTPM:      cfg.RateLimitTPM,
		CacheTTLSec:       cfg.CacheTTLSec,
		AnalyzerTimeoutMs: cfg.AnalyzerTimeoutMs,
		OutputScanEnabled: cfg.OutputScanEnabled,
		FailoverEnabled:   cfg.FallbackTargetURL != "",
		AuditAllRequests:  true,

		PIIRedactionEnabled:    true,
		ToxicityEnabled:        cfg.ToxicityEnabled,
		ToxicityBlockThreshold: cfg.ToxicityBlockThreshold,
		CodeLeakBlock:          cfg.CodeLeakBlock,
		PIIEntities:            DefaultPIIEntities(),
	}
}

// NewManager creates a Manager seeded with config-derived defaults. Call Load to
// hydrate persisted overrides, then register hooks and call ApplyAll.
func NewManager(st store, cfg *config.Config) *Manager {
	return &Manager{st: st, current: DefaultsFromConfig(cfg)}
}

// Load merges any persisted document over the in-memory defaults. When nothing
// is stored yet it persists the defaults so the row exists for future writes.
func (m *Manager) Load(ctx context.Context) error {
	raw, err := m.st.GetSettingsRaw(ctx)
	if err != nil {
		return err
	}
	if raw == nil {
		return m.persist(ctx, m.Get())
	}
	m.mu.Lock()
	merged := m.current
	// Unmarshal over the defaults so keys absent from an older document keep
	// their seeded value (forward-compatible across settings additions).
	_ = json.Unmarshal(raw, &merged)
	merged.clamp()
	m.current = merged
	m.mu.Unlock()
	return nil
}

// Get returns a copy of the current snapshot. Cheap; safe to call per-request.
func (m *Manager) Get() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := m.current
	// Copy the map so callers can't mutate shared state.
	ents := make(map[string]bool, len(s.PIIEntities))
	for k, v := range s.PIIEntities {
		ents[k] = v
	}
	s.PIIEntities = ents
	return s
}

// OnApply registers a hook fired on every change and on ApplyAll.
func (m *Manager) OnApply(fn ApplyFunc) { m.applyFns = append(m.applyFns, fn) }

// ApplyAll fires every hook with the current snapshot. Call once after Load and
// after all hooks are registered so downstream components adopt the persisted
// values at startup.
func (m *Manager) ApplyAll() {
	s := m.Get()
	for _, fn := range m.applyFns {
		fn(s)
	}
}

// Update merges a partial JSON patch into the current settings, clamps it to
// valid ranges, persists the full document, and fires the apply hooks.
func (m *Manager) Update(ctx context.Context, patch []byte) (Settings, error) {
	m.mu.Lock()
	next := m.current
	if err := json.Unmarshal(patch, &next); err != nil {
		m.mu.Unlock()
		return Settings{}, err
	}
	next.clamp()
	m.current = next
	m.mu.Unlock()

	if err := m.persist(ctx, next); err != nil {
		return next, err
	}
	for _, fn := range m.applyFns {
		fn(next)
	}
	return m.Get(), nil
}

func (m *Manager) persist(ctx context.Context, s Settings) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return m.st.SaveSettingsRaw(ctx, raw)
}

// clamp enforces safe bounds so a bad dashboard value can't disable governance
// or wedge the limiter.
func (s *Settings) clamp() {
	if s.RateLimitRPM < 0 {
		s.RateLimitRPM = 0
	}
	if s.RateLimitTPM < 0 {
		s.RateLimitTPM = 0
	}
	if s.CacheTTLSec < 0 {
		s.CacheTTLSec = 0
	}
	// Keep the inline ML deadline within a sane window; 0 would disable the gate.
	if s.AnalyzerTimeoutMs < 10 {
		s.AnalyzerTimeoutMs = 10
	}
	if s.AnalyzerTimeoutMs > 10000 {
		s.AnalyzerTimeoutMs = 10000
	}
	if s.ToxicityBlockThreshold < 0 {
		s.ToxicityBlockThreshold = 0
	}
	if s.ToxicityBlockThreshold > 1 {
		s.ToxicityBlockThreshold = 1
	}
	if s.PIIEntities == nil {
		s.PIIEntities = DefaultPIIEntities()
	}
}
